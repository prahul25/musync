import { createServer } from "http";
import { Server } from "socket.io";
import next from "next";
console.log("Starting server...");
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    handle(req, res);
  });

  const io = new Server(httpServer, {
    cors: { origin: "*" },
  });

  // rooms[roomId] = { host: socketId | null, listeners: Set<socketId> }
  const rooms = {};

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("join-room", ({ roomId, role }) => {
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
      io.to(target).emit("offer", { sdp, from: socket.id });
    });

    socket.on("answer", ({ target, sdp }) => {
      io.to(target).emit("answer", { sdp, from: socket.id });
    });

    socket.on("ice-candidate", ({ target, candidate }) => {
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

  httpServer.listen(3000, () => {
    console.log("🚀 Server running on http://localhost:3000");
  });
});