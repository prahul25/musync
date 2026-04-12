"use client";

import { useEffect, useRef } from "react";
import { socket } from "../lib/socket";


const peerConnections: Record<string, RTCPeerConnection> = {};

export default function Room({ roomId }: { roomId: string }) {
  const localStream = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
 const createPeer = (id: string) => {
    const pc = new RTCPeerConnection();

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("ice-candidate", {
          target: id,
          candidate: event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      if (audioRef.current) {
        audioRef.current.srcObject = event.streams[0];
      }
    };

    if (localStream.current) {
      localStream.current.getTracks().forEach(track => {
        pc.addTrack(track, localStream.current!);
      });
    }

    peerConnections[id] = pc;
    return pc;
  };

  const createOffer = async (id: string) => {
    const pc = createPeer(id);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socket.emit("offer", { target: id, sdp: offer });
  };
  useEffect(() => {
    socket.emit("join-room", roomId);

    socket.on("all-users", (users) => {
      users.forEach(createOffer);
    });

    socket.on("user-joined", (id) => {
      createOffer(id);
    });

    socket.on("offer", async ({ sdp, from }) => {
      const pc = createPeer(from);

      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit("answer", { target: from, sdp: answer });
    });

    socket.on("answer", async ({ sdp, from }) => {
      await peerConnections[from].setRemoteDescription(
        new RTCSessionDescription(sdp)
      );
    });

    socket.on("ice-candidate", ({ candidate, from }) => {
      peerConnections[from].addIceCandidate(
        new RTCIceCandidate(candidate)
      );
    });
  }, []);

 

  const startSharing = async () => {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });

    localStream.current = stream;
  };

  return (
    <div>
      <h1>Room: {roomId}</h1>

      <button onClick={startSharing}>
        🎧 Share Tab Audio
      </button>

      <audio ref={audioRef} autoPlay controls />
    </div>
  );
}