const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Middleware
app.use(cors());
app.use(express.json());

// Ruta per unir-se a la sala existent
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "join.html"));
});

// Ruta per crear/gestionar la sala
app.get("/ses", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "session.html"));
});

// Static files AFTER routes
app.use(express.static("public"));

// API per obtenir el temps del servidor amb alta precisió
app.get("/api/time", (req, res) => {
  const serverTime = Date.now();
  const hrTime = process.hrtime.bigint();

  res.json({
    timestamp: serverTime,
    hrtime: hrTime.toString(),
    iso: new Date(serverTime).toISOString(),
  });
});

// Variables globals per gestionar la sala única
let globalRoom = {
  id: "SINCROO_ROOM",
  createdAt: Date.now(),
  targetTime: null,
  participants: new Map(), // Canviem Set per Map per guardar informació addicional
  status: "waiting", // waiting, countdown, playing, ended
  startedAt: null,
  currentPosition: 0,
};

const connectedClients = new Map();

// Funció auxiliar per convertir participants Map en Array
function getParticipantsArray() {
  return Array.from(globalRoom.participants.entries()).map(([id, info]) => ({
    id,
    mediaFileName: info.mediaFileName || "Fitxer desconegut",
    joinedAt: info.joinedAt,
  }));
}

// Gestió de connexions WebSocket
io.on("connection", (socket) => {
  console.log(`Client connectat: ${socket.id}`);

  const clientInfo = {
    id: socket.id,
    connectedAt: Date.now(),
    lastPing: Date.now(),
    offset: 0,
    isCalibrated: false,
  };

  connectedClients.set(socket.id, clientInfo);

  // Enviament del temps del servidor per sincronització inicial
  socket.emit("server-time", {
    timestamp: Date.now(),
    hrtime: process.hrtime.bigint().toString(),
  });

  // Gestió del procés de calibratge NTP-like
  socket.on("sync-request", (data) => {
    const now = Date.now();
    const hrTime = process.hrtime.bigint();

    socket.emit("sync-response", {
      clientRequestTime: data.clientTime,
      serverTime: now,
      serverHrTime: hrTime.toString(),
      sequenceId: data.sequenceId,
    });
  });

  // Actualització de l'offset del client
  socket.on("offset-update", (data) => {
    if (connectedClients.has(socket.id)) {
      const client = connectedClients.get(socket.id);
      client.offset = data.offset;
      client.isCalibrated = true;
      client.lastPing = Date.now();
      connectedClients.set(socket.id, client);

      console.log(`Client ${socket.id} calibrat amb offset: ${data.offset}ms`);
    }
  });

  // Crear o actualitzar la sala global
  socket.on("setup-room", (data) => {
    globalRoom.targetTime = data.targetTime;
    globalRoom.status = "waiting";
    globalRoom.startedAt = null;
    globalRoom.currentPosition = 0;

    // El creador NO s'afegeix automàticament com a participant
    // Només unir el socket a la sala per rebre notificacions
    socket.join(globalRoom.id);

    socket.emit("room-setup", {
      room: {
        ...globalRoom,
        participants: getParticipantsArray(),
      },
    });

    // Notificar a tots els clients connectats de l'actualització de la sala
    io.emit("room-updated", {
      room: {
        ...globalRoom,
        participants: getParticipantsArray(),
      },
    });

    console.log(
      `Sala configurada per ${socket.id}, hora: ${data.targetTime} (${new Date(
        data.targetTime
      ).toLocaleString()})`
    );

    // Automàticament iniciar la sincronització
    const now = Date.now();
    const timeToStart = globalRoom.targetTime - now;

    if (timeToStart > 0) {
      globalRoom.status = "countdown";

      // Notificar a tots els clients del canvi d'estat
      io.emit("room-updated", {
        room: {
          ...globalRoom,
          participants: getParticipantsArray(),
        },
      });

      // Inicia el compte enrere per tots els participants
      io.to(globalRoom.id).emit("countdown-started", {
        targetTime: globalRoom.targetTime,
        timeRemaining: timeToStart,
      });

      // També enviar a tots els clients (incloent els que no s'han unit)
      io.emit("countdown-started", {
        targetTime: globalRoom.targetTime,
        timeRemaining: timeToStart,
      });

      // Programa l'inici de la reproducció
      setTimeout(() => {
        globalRoom.status = "playing";
        globalRoom.startedAt = Date.now();

        // Notificar a tots els clients del canvi d'estat a playing
        io.emit("room-updated", {
          room: {
            ...globalRoom,
            participants: getParticipantsArray(),
          },
        });

        io.to(globalRoom.id).emit("playback-start", {
          startTime: globalRoom.startedAt,
          targetTime: globalRoom.targetTime,
        });

        // També enviar a tots els clients
        io.emit("playback-start", {
          startTime: globalRoom.startedAt,
          targetTime: globalRoom.targetTime,
        });
      }, timeToStart);
    } else {
      // Iniciar immediatament si el temps ja ha passat
      globalRoom.status = "playing";
      globalRoom.startedAt = now;
      const elapsed = now - globalRoom.targetTime;

      // Notificar a tots els clients del canvi d'estat
      io.emit("room-updated", {
        room: {
          ...globalRoom,
          participants: getParticipantsArray(),
        },
      });

      io.to(globalRoom.id).emit("playback-start", {
        startTime: globalRoom.startedAt,
        targetTime: globalRoom.targetTime,
        immediate: true,
        seekTo: elapsed / 1000, // posició en segons
      });

      // També enviar a tots els clients
      io.emit("playback-start", {
        startTime: globalRoom.startedAt,
        targetTime: globalRoom.targetTime,
        immediate: true,
        seekTo: elapsed / 1000, // posició en segons
      });
    }

    console.log(`Sincronització iniciada automàticament per la sala global`);
  });

  // Unir-se a la sala global
  socket.on("join-room", (data) => {
    const mediaFileName = data?.mediaFileName || "Fitxer desconegut";

    globalRoom.participants.set(socket.id, {
      mediaFileName: mediaFileName,
      joinedAt: Date.now(),
    });
    socket.join(globalRoom.id);

    // Calcular posició actual si està reproduint
    let currentPosition = 0;
    if (globalRoom.status === "playing" && globalRoom.startedAt) {
      const elapsed = Date.now() - globalRoom.startedAt;
      currentPosition = elapsed / 1000; // en segons
    }

    // Notifica a tots els participants
    io.to(globalRoom.id).emit("participant-joined", {
      participantId: socket.id,
      totalParticipants: globalRoom.participants.size,
      participants: getParticipantsArray(),
    });

    // Envia la informació de la sala al nou participant
    socket.emit("room-joined", {
      room: {
        ...globalRoom,
        participants: getParticipantsArray(),
        currentPosition: currentPosition,
      },
    });

    console.log(
      `Client ${socket.id} s'ha unit a la sala global amb fitxer: ${mediaFileName}`
    );
  });

  // Sortir de la sala
  socket.on("leave-room", () => {
    if (!globalRoom.participants.has(socket.id)) {
      console.log(`Client ${socket.id} no estava a la sala`);
      return;
    }

    // Eliminar de la sala
    globalRoom.participants.delete(socket.id);

    // Notificar als altres participants
    io.emit("participant-left", {
      participantId: socket.id,
      totalParticipants: globalRoom.participants.size,
      participants: getParticipantsArray(),
    });

    console.log(`Client ${socket.id} ha sortit voluntàriament de la sala`);
  });

  // Reconfigurar la sala global
  socket.on("reconfigure-room", () => {
    // Reset de la sala
    globalRoom.targetTime = null;
    globalRoom.status = "waiting";
    globalRoom.startedAt = null;
    globalRoom.currentPosition = 0;

    // Notificar a tots els clients de la reconfiguració
    io.emit("room-reconfigured");

    // També enviar room-updated amb l'estat reset
    io.emit("room-updated", {
      room: {
        ...globalRoom,
        participants: getParticipantsArray(),
      },
    });

    console.log(`Sala reconfigurada per ${socket.id}`);
  });

  // Actualitzacions d'estat de reproducció
  socket.on("playback-state", (data) => {
    const { state, currentTime, timestamp } = data;

    // Retransmet l'estat a tots els altres participants
    socket.to(globalRoom.id).emit("participant-state", {
      participantId: socket.id,
      state: state,
      currentTime: currentTime,
      timestamp: timestamp,
    });
  });

  // Gestió de desconnexions
  socket.on("disconnect", () => {
    console.log(`Client desconnectat: ${socket.id}`);

    // Elimina el client de la llista
    connectedClients.delete(socket.id);

    // Elimina el client de la sala global
    if (globalRoom.participants.has(socket.id)) {
      globalRoom.participants.delete(socket.id);

      // Notifica als altres participants
      io.emit("participant-left", {
        participantId: socket.id,
        totalParticipants: globalRoom.participants.size,
        participants: getParticipantsArray(),
      });

      console.log(`Client ${socket.id} ha abandonat la sala global`);
    }
  });

  // Ping per mantenir la connexió i mesurar latència
  socket.on("ping", (data) => {
    socket.emit("pong", {
      clientTime: data.timestamp,
      serverTime: Date.now(),
    });
  });
});

// Estadístiques del servidor
app.get("/api/stats", (req, res) => {
  const currentPosition =
    globalRoom.status === "playing" && globalRoom.startedAt
      ? (Date.now() - globalRoom.startedAt) / 1000
      : 0;

  res.json({
    connectedClients: connectedClients.size,
    globalRoom: {
      ...globalRoom,
      participants: getParticipantsArray(),
      currentPosition: currentPosition,
    },
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
  });
});

// API per obtenir informació de la sala
app.get("/api/room", (req, res) => {
  const currentPosition =
    globalRoom.status === "playing" && globalRoom.startedAt
      ? (Date.now() - globalRoom.startedAt) / 1000
      : 0;

  res.json({
    room: {
      ...globalRoom,
      participants: getParticipantsArray(),
      currentPosition: currentPosition,
    },
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor Sincroo executant-se al port ${PORT}`);
  console.log(`📱 Obre http://localhost:${PORT} al navegador`);
});

module.exports = { app, server, io };
