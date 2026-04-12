"use client";

import { useCallback, useEffect, useRef } from "react";
import { getSocket } from "../lib/socket";

const socket = getSocket();
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

  const createOffer = useCallback(async (id: string) => {
    const pc = createPeer(id);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socket.emit("offer", { target: id, sdp: offer });
  }, []);
useEffect(() => {
  socket.emit("join-room", roomId);

  socket.on("all-users", (users: string[]) => {
    users.forEach(createOffer);
  });

  socket.on("user-joined", (id: string) => {
    createOffer(id);
  });

  socket.on("offer", async ({ sdp, from }: { sdp: RTCSessionDescriptionInit; from: string }) => {
    const pc = createPeer(from);

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit("answer", { target: from, sdp: answer });
  });

  socket.on("answer", async ({ sdp, from }: { sdp: RTCSessionDescriptionInit; from: string }) => {
    const pc = peerConnections[from];
    if (!pc) return;

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  });

  socket.on("ice-candidate", ({ candidate, from }: { candidate: RTCIceCandidateInit; from: string }) => {
    const pc = peerConnections[from];
    if (!pc) return;

    pc.addIceCandidate(new RTCIceCandidate(candidate));
  });

}, [roomId, createOffer]);

  useEffect(() => {
  socket.emit("join-room", roomId);

  const handleAllUsers = (users: string[]) => {
    users.forEach(createOffer);
  };

  const handleUserJoined = (id: string) => {
    createOffer(id);
  };

  const handleOffer = async ({ sdp, from }: { sdp: RTCSessionDescriptionInit; from: string }) => {
    const pc = createPeer(from);

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit("answer", { target: from, sdp: answer });
  };

  const handleAnswer = async ({ sdp, from }: { sdp: RTCSessionDescriptionInit; from: string }) => {
    const pc = peerConnections[from];
    if (!pc) return;

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  };

  const handleIce = ({ candidate, from }: { candidate: RTCIceCandidateInit; from: string }) => {
    const pc = peerConnections[from];
    if (!pc) return;

    pc.addIceCandidate(new RTCIceCandidate(candidate));
  };

  socket.on("all-users", handleAllUsers);
  socket.on("user-joined", handleUserJoined);
  socket.on("offer", handleOffer);
  socket.on("answer", handleAnswer);
  socket.on("ice-candidate", handleIce);

  return () => {
    socket.off("all-users", handleAllUsers);
    socket.off("user-joined", handleUserJoined);
    socket.off("offer", handleOffer);
    socket.off("answer", handleAnswer);
    socket.off("ice-candidate", handleIce);
  };
}, [roomId,createOffer]);
 

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