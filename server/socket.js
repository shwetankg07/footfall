import mongoose from "mongoose";
import { Server } from "socket.io";
import Site from "./models/site.model.js";
import { userFromToken } from "./middlewares/auth.middleware.js";
import { roleOf } from "./middlewares/site.middleware.js";
import { liveCount, onLiveChange } from "./utils/live.js";

let io = null;

export const emitToSite = (siteId, event, data) => io?.to(`site:${siteId}`).emit(event, data);
export const emitToUser = (userId, event, data) => io?.to(`user:${userId}`).emit(event, data);

// After access to a site changes (share link rotated, member removed, site deleted),
// everyone watching it has to prove access again.
export const resetWatchers = (siteId) => {
  if (!io) return;
  const room = `site:${siteId}`;
  io.to(room).emit("rewatch");
  io.in(room).socketsLeave(room);
};

const siteForWatcher = async (user, payload) => {
  const { siteId, shareToken } = payload ?? {};
  if (typeof shareToken === "string" && shareToken) {
    return Site.findOne({ shareToken });
  }
  if (!user || !mongoose.isValidObjectId(siteId)) return null;
  const site = await Site.findById(siteId);
  return site && roleOf(site, user._id) ? site : null;
};

export const initSocket = (server, origins) => {
  io = new Server(server, { cors: { origin: origins } });

  // Signed-in dashboards send a 2-minute token from GET /api/auth/socket-token.
  // Without one the socket is anonymous, which is enough for public share links.
  io.use((socket, next) => {
    userFromToken(socket.handshake.auth?.token, "socket")
      .then((user) => {
        socket.data.user = user;
        next();
      })
      .catch(() => next());
  });

  io.on("connection", (socket) => {
    const { user } = socket.data;
    if (user) socket.join(`user:${user._id}`);

    // A dashboard tab watches one site at a time.
    socket.on("watch", async (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      try {
        const site = await siteForWatcher(user, payload);
        if (!site) return reply({ ok: false });
        for (const room of socket.rooms) {
          if (room.startsWith("site:")) socket.leave(room);
        }
        socket.join(`site:${site._id}`);
        reply({ ok: true, live: liveCount(site._id) });
      } catch (error) {
        console.error(error);
        reply({ ok: false });
      }
    });
  });

  onLiveChange((siteId, count) => emitToSite(siteId, "live", { siteId, count }));
};
