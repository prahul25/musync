"use client";

import { useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";

export default function Landing() {
  const router = useRouter();

  const createRoom = () => {
    const id = uuidv4().slice(0, 6).toUpperCase();
    // Mark this room as created (so RoomUI knows you're the host)
    sessionStorage.setItem(`musync-created-${id}`, "1");
    sessionStorage.setItem(`musync-role-${id}`, "host");
    router.push(`/room/${id}`);
  };

  const joinRoom = () => {
    const roomId = prompt("Enter Room ID")?.trim().toUpperCase();
    if (roomId) router.push(`/room/${roomId}`);
  };

  return (
    <div className="h-screen flex flex-col items-center justify-center bg-black text-white gap-4">
      <h1 className="text-5xl font-bold">🎧 MuSync</h1>
      <p className="text-gray-400 mb-6">Share your music tab. Listen together.</p>
      <div className="flex gap-4">
        <button
          onClick={createRoom}
          className="px-8 py-4 rounded-2xl bg-gradient-to-r from-purple-500 to-pink-500 hover:scale-105 transition font-semibold"
        >
          Create Room 🚀
        </button>
        <button
          onClick={joinRoom}
          className="px-8 py-4 rounded-2xl border border-gray-600 hover:bg-gray-800 transition font-semibold"
        >
          Join Room 🔗
        </button>
      </div>
    </div>
  );
}