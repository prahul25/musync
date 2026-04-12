"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { getSocket } from "@/app/lib/socket";

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export default function RoomUI({ roomId }: { roomId: string }) {
  // --- Role detection ---
  // The creator of the room is the host. Everyone else joining via link is a listener.
  // We store this in sessionStorage so a refresh keeps role intact.
  const [role] = useState<"host" | "listener" | null>(() => {
  if (typeof window === "undefined") return null;

  const stored = sessionStorage.getItem(`musync-role-${roomId}`);

  if (stored === "host" || stored === "listener") {
    return stored;
  }

  const created = sessionStorage.getItem(`musync-created-${roomId}`);
  const r = created ? "host" : "listener";

  sessionStorage.setItem(`musync-role-${roomId}`, r);

  return r;
});
  const [isSharing, setIsSharing] = useState(false);
  const [isSynced, setIsSynced] = useState(false);
  const [listenerCount, setListenerCount] = useState(0);
  const [hasHost, setHasHost] = useState(false);
  const [copied, setCopied] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  const localStream = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  // host keeps a map of listener socketId → RTCPeerConnection
  const peerConnections = useRef<Record<string, RTCPeerConnection>>({});
  const pendingListeners = useRef<string[]>([]);
  const roomLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/room/${roomId}`
      : "";

       const createPeerConnection = useCallback(
    (peerId: string) => {
      const socket = getSocket();
      const pc = new RTCPeerConnection(ICE_SERVERS);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("ice-candidate", {
            target: peerId,
            candidate: event.candidate,
          });
        }
      };

      pc.ontrack = (event) => {
        // Listener receives audio from host
        if (audioRef.current && event.streams[0]) {
          audioRef.current.srcObject = event.streams[0];
          setIsSynced(true);
          setStatusMsg("🎵 Synced! Listening live.");
        }
      };

      peerConnections.current[peerId] = pc;
      return pc;
    },
    []
  );


  // --- Socket & WebRTC setup ---
  useEffect(() => {
    if (!role) return;
    const socket = getSocket();
    socket.connect();

    socket.emit("join-room", { roomId, role });

    socket.on("room-info", ({ listenerCount, hasHost }) => {
      setListenerCount(listenerCount);
      setHasHost(hasHost);
    });

    // HOST: someone connected — initiate offer to them
    socket.on("listener-joined", async (listenerId: string) => {
      if (role !== "host") return;
      setStatusMsg(`New listener joined, connecting...`);
      const pc = createPeerConnection(listenerId);
      if (localStream.current) {
        localStream.current
          .getTracks()
          .forEach((track) => pc.addTrack(track, localStream.current!));
      }
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("offer", { target: listenerId, sdp: offer });
    });

    // HOST: re-send tracks to all listeners when stream is ready
    socket.on("all-listeners", (listeners: string[]) => {
      if (role !== "host") return;
      // Will be used after startSharing — stored but not acted on until stream exists
      pendingListeners.current = listeners;
    });

    // HOST: clean up when listener disconnects
    socket.on("listener-left", (listenerId: string) => {
      peerConnections.current[listenerId]?.close();
      delete peerConnections.current[listenerId];
    });

    // LISTENER: receive offer from host
    socket.on("offer", async ({ sdp, from }: { sdp: RTCSessionDescriptionInit; from: string }) => {
      if (role !== "listener") return;
      const pc = createPeerConnection(from);
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("answer", { target: from, sdp: answer });
    });

    // Both: handle answer
    socket.on("answer", async ({ sdp, from }: { sdp: RTCSessionDescriptionInit; from: string }) => {
      await peerConnections.current[from]?.setRemoteDescription(
        new RTCSessionDescription(sdp)
      );
    });

    // Both: handle ICE
    socket.on("ice-candidate", ({ candidate, from }: { candidate: RTCIceCandidateInit; from: string }) => {
      peerConnections.current[from]?.addIceCandidate(
        new RTCIceCandidate(candidate)
      );
    });

    socket.on("host-left", () => {
      setHasHost(false);
      setIsSynced(false);
      setStatusMsg("Host left the room.");
    });

    return () => {
      socket.off("room-info");
      socket.off("listener-joined");
      socket.off("all-listeners");
      socket.off("listener-left");
      socket.off("offer");
      socket.off("answer");
      socket.off("ice-candidate");
      socket.off("host-left");
      socket.disconnect();
      Object.values(peerConnections.current).forEach((pc) => pc.close());
      peerConnections.current = {};
      localStream.current?.getTracks().forEach((t) => t.stop());
    };
  }, [role, roomId,createPeerConnection]);

 

  // HOST: start sharing tab audio
  const startSharing = async () => {
    try {
      // getDisplayMedia with audio:true captures tab audio on Chrome
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true, // audio-only; some browsers require video:true as well
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          sampleRate: 44100,
        },
      } as DisplayMediaStreamOptions);

      // Check if user's selected tab actually has audio
    if (stream.getAudioTracks().length === 0) {
      setStatusMsg(
        "⚠️ No audio captured. In the share dialog, make sure to tick 'Share tab audio' at the bottom left, and pick the tab playing music."
      );
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    // Drop the video track — we only need audio
    stream.getVideoTracks().forEach((t) => t.stop());
    const audioOnlyStream = new MediaStream(stream.getAudioTracks());

      localStream.current = audioOnlyStream;
      setIsSharing(true);
      setStatusMsg("Sharing audio. Listeners can now sync.");

      // Add tracks to any existing peer connections
      Object.entries(peerConnections.current).forEach(([, pc]) => {
      audioOnlyStream.getTracks().forEach((track) => {
        pc.addTrack(track, audioOnlyStream);
      });
    });

      // Also send offers to any listeners who joined before sharing started
      const socket = getSocket();
      const pending = pendingListeners.current;
      for (const listenerId of pending) {
      const pc = createPeerConnection(listenerId);
      audioOnlyStream.getTracks().forEach((track) =>
        pc.addTrack(track, audioOnlyStream)
      );
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("offer", { target: listenerId, sdp: offer });
    }
      pendingListeners.current = [];

      // When user stops sharing from the browser's built-in stop button
    audioOnlyStream.getAudioTracks()[0].onended = () => {
      setIsSharing(false);
      localStream.current = null;
      setStatusMsg("Audio sharing stopped.");
    };
    } catch (err) {
      if (err instanceof Error) {
    setStatusMsg(`❌ Error: ${err.message}`);
  }
    
    console.error(err);
  }
  };

  const stopSharing = () => {
    localStream.current?.getTracks().forEach((t) => t.stop());
    localStream.current = null;
    setIsSharing(false);
    setStatusMsg("Stopped sharing.");
  };

  // LISTENER: click Sync to unmute audio element (browser autoplay policy)
  const syncAndListen = () => {
    if (audioRef.current) {
      audioRef.current.play().catch(() => {});
      setIsSynced(true);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(roomLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!role) return null;

  return (
    <div className="min-h-screen bg-black text-white p-6 max-w-xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <p className="text-gray-500 text-sm mb-1">
          {role === "host" ? "You are the host" : "You are a listener"}
        </p>
        <h1 className="text-3xl font-bold tracking-tight">
          🎧 Room <span className="text-purple-400">{roomId}</span>
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          {listenerCount} listener{listenerCount !== 1 ? "s" : ""} •{" "}
          {hasHost ? "Host online" : "No host"}
        </p>
      </div>

      {/* Share link */}
      <div className="bg-gray-900 rounded-2xl p-4 mb-6">
        <p className="text-gray-400 text-sm mb-3">Invite friends</p>
        <div className="flex gap-2">
          <input
            value={roomLink}
            readOnly
            className="flex-1 bg-black border border-gray-700 px-3 py-2 rounded-xl text-sm text-gray-300 outline-none"
          />
          <button
            onClick={copyLink}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-xl text-sm transition"
          >
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>
      </div>

      {/* Status */}
      {statusMsg && (
        <div className="bg-gray-900 border border-gray-700 rounded-2xl p-3 mb-6 text-sm text-gray-300">
          {statusMsg}
        </div>
      )}

      {/* HOST controls */}
      {role === "host" && (
        <div className="bg-gray-900 rounded-2xl p-5 mb-6">
          <h2 className="text-lg font-semibold mb-1">Host Controls</h2>
          <p className="text-gray-500 text-sm mb-4">
            Click share, then pick the Chrome tab playing music. Make sure to
            check <strong className="text-gray-300">Share tab audio</strong>{" "}
            in the dialog.
          </p>
          {!isSharing ? (
            <button
              onClick={startSharing}
              className="w-full py-3 bg-linear-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 rounded-xl font-semibold transition"
            >
              🎵 Start Sharing Audio
            </button>
          ) : (
            <button
              onClick={stopSharing}
              className="w-full py-3 bg-red-700 hover:bg-red-600 rounded-xl font-semibold transition"
            >
              ⏹ Stop Sharing
            </button>
          )}
        </div>
      )}

      {/* LISTENER controls */}
      {role === "listener" && (
        <div className="bg-gray-900 rounded-2xl p-5 mb-6">
          <h2 className="text-lg font-semibold mb-1">Listener Controls</h2>
          <p className="text-gray-500 text-sm mb-4">
            {hasHost
              ? "The host is online. Click Sync to start listening."
              : "Waiting for the host to join and share audio..."}
          </p>
          <button
            onClick={syncAndListen}
            disabled={!hasHost}
            className={`w-full py-3 rounded-xl font-semibold transition ${
              hasHost
                ? "bg-linear-to-r from-blue-600 to-teal-600 hover:from-blue-500 hover:to-teal-500"
                : "bg-gray-800 text-gray-600 cursor-not-allowed"
            }`}
          >
            {isSynced ? "🔊 Synced & Listening" : "🔄 Sync & Listen"}
          </button>
          {/* Hidden audio element receives the WebRTC stream */}
          <audio ref={audioRef} autoPlay className="hidden" />
        </div>
      )}

      {/* How it works */}
      <div className="bg-gray-950 border border-gray-800 rounded-2xl p-4 text-sm text-gray-500">
        <p className="font-medium text-gray-400 mb-2">How it works</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>Host clicks &quot;Start Sharing Audio&quot; and picks the music tab</li>
          <li>Share the room link with friends</li>
          <li>Friends open the link and click &quot;Sync & Listen&quot;</li>
          <li>Audio streams peer-to-peer in real time</li>
        </ol>
      </div>
    </div>
  );
}