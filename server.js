import { createServer } from "http";
import { Server } from "socket.io";
import next from "next";
console.log("Starting server...");
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

const rateLimits = new Map(); // socket.id -> timestamps
const joinLimits = new Map(); // IP -> join attempts

const MAX_LISTENERS = 10;



app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    handle(req, res);
  });

  const io = new Server(httpServer, {
    cors: {
      origin: ["http://localhost:3000", "https://musync-mauve.vercel.app"],
    },
  });

  // rooms[roomId] = { host: socketId | null, listeners: Set<socketId> }
  const rooms = {};

  io.on("connection", (socket) => {

    const MAX_EVENTS = 20; // max events
const WINDOW_MS = 10000; // 10 sec

socket.onAny(() => {
  const now = Date.now();
  const events = rateLimits.get(socket.id) || [];

  const filtered = events.filter((t) => now - t < WINDOW_MS);
  filtered.push(now);

  rateLimits.set(socket.id, filtered);

  if (filtered.length > MAX_EVENTS) {
    console.log("Rate limit exceeded:", socket.id);
    socket.emit("rate-limit");
    socket.disconnect();
  }
});
    console.log("User connected:", socket.id);

   socket.on("join-room", ({ roomId, role }) => {

  // 1. validate first
  if (!roomId || typeof roomId !== "string" || roomId.length > 50) {
    socket.emit("invalid-room");
    return;
  }

  // 2. validate role
  if (role !== "host" && role !== "listener") {
    socket.emit("invalid-room");
    return;
  }

  // 3. IP rate limit
  const ip = socket.handshake.address;
  const now = Date.now();
  const attempts = joinLimits.get(ip) || [];
  const filtered = attempts.filter((t) => now - t < 60000);
  filtered.push(now);
  joinLimits.set(ip, filtered);
  if (filtered.length > 10) {
    socket.emit("too-many-requests");
    return;
  }

  // 4. now safe to create room
  if (!rooms[roomId]) {
    rooms[roomId] = { host: null, listeners: new Set() };
  }

  // 5. check capacity
  if (role !== "host" && rooms[roomId].listeners.size >= MAX_LISTENERS) {
    socket.emit("room-full");
    return;
  }

  // 6. prevent host takeover
  if (role === "host" && rooms[roomId].host) {
    socket.emit("room-taken");
    return;
  }

  socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.role = role;

      if (!rooms[roomId]) {
        rooms[roomId] = { host: null, listeners: new Set() };
      }

      if (role === "host") {
        rooms[roomId].host = socket.id;
        // Tell the new host who's already listening
        socket.emit("all-listeners", [...rooms[roomId].listeners]);
      } else {
        rooms[roomId].listeners.add(socket.id);
        // Tell the host a new listener joined so it can initiate offer
        const hostId = rooms[roomId].host;
        if (hostId) {
          io.to(hostId).emit("listener-joined", socket.id);
        }
      }

      // Broadcast updated participant count to room
      io.to(roomId).emit("room-info", {
        listenerCount: rooms[roomId].listeners.size,
        hasHost: !!rooms[roomId].host,
      });
    });

    // WebRTC signaling — host → listener
    socket.on("offer", ({ target, sdp }) => {
      if (!target || !sdp || typeof target !== "string") return; // ignore bad payloads
      io.to(target).emit("offer", { sdp, from: socket.id });
    });

    socket.on("answer", ({ target, sdp }) => {
      if (!target || !sdp || typeof target !== "string") return;
      io.to(target).emit("answer", { sdp, from: socket.id });
    });

    socket.on("ice-candidate", ({ target, candidate }) => {
      if (!target || !candidate || typeof target !== "string") return;
      io.to(target).emit("ice-candidate", { candidate, from: socket.id });
    });

    socket.on("disconnect", () => {
      const { roomId, role } = socket.data;
      if (!roomId || !rooms[roomId]) return;

      if (role === "host") {
        rooms[roomId].host = null;
        io.to(roomId).emit("host-left");
      } else {
        rooms[roomId].listeners.delete(socket.id);
        // Notify host so it can clean up that peer connection
        const hostId = rooms[roomId].host;
        if (hostId) io.to(hostId).emit("listener-left", socket.id);
      }

      io.to(roomId).emit("room-info", {
        listenerCount: rooms[roomId].listeners.size,
        hasHost: !!rooms[roomId].host,
      });

      // Clean up empty rooms
      if (!rooms[roomId].host && rooms[roomId].listeners.size === 0) {
        delete rooms[roomId];
      }

      console.log(`User ${socket.id} (${role}) disconnected from ${roomId}`);
    });
  });

  setInterval(() => {
  rateLimits.clear();
  joinLimits.clear();
  // Also clean rooms older than 2 hours with no activity
  for (const [roomId, room] of Object.entries(rooms)) {
    if (!room.host && room.listeners.size === 0) {
      delete rooms[roomId];
    }
  }
}, 5 * 60 * 1000);

  httpServer.listen(process.env.PORT || 3000, () => {
    console.log(`🚀 Server running on ${process.env.PORT}`);
  });
});
