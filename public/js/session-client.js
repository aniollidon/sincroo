/**
 * Client per gestionar la sala de Sincroo
 */

class SessionClient {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.serverTimeOffset = 0;
    this.targetTime = null;
    this.room = null;
    this.countdownInterval = null;

    this.initializeElements();
    this.connect();
    this.setupEventListeners();
    this.updateTimeSuggestions();

    // Actualitzar temps del servidor cada segon
    setInterval(() => this.updateServerTimeDisplay(), 1000);

    // Actualitzar propostes cada minut
    setInterval(() => this.updateTimeSuggestions(), 60000);
  }

  initializeElements() {
    // Elements d'estat
    this.connectionStatus = document.getElementById("connectionStatus");
    this.connectionText = document.getElementById("connectionText");
    this.serverTime = document.getElementById("serverTime");
    this.offsetDisplay = document.getElementById("offsetDisplay");

    // Cards
    this.setupCard = document.getElementById("setupCard");
    this.roomCard = document.getElementById("roomCard");

    // Elements de configuració
    this.targetTimeInput = document.getElementById("targetTime");
    this.timeSuggestions = document.getElementById("timeSuggestions");

    // Elements de sala configurada
    this.configuredTime = document.getElementById("configuredTime");
    this.participantCount = document.getElementById("participantCount");
    this.participantsList = document.getElementById("participantsList");

    // Botons
    this.setupRoomBtn = document.getElementById("setupRoomBtn");
    this.reconfigureBtn = document.getElementById("reconfigureBtn");

    // Countdown dins de la sala
    this.roomCountdown = document.getElementById("roomCountdown");
    this.roomCountdownDisplay = document.getElementById("roomCountdownDisplay");
  }

  connect() {
    try {
      this.socket = io("/", {
        transports: ["websocket", "polling"],
        timeout: 5000,
      });

      this.setupSocketListeners();
    } catch (error) {
      console.error("Error connecting to server:", error);
    }
  }

  setupSocketListeners() {
    this.socket.on("connect", () => {
      console.log("Connected to server");
      this.isConnected = true;
      this.connectionStatus.classList.add("connected");
      this.connectionText.textContent = "Connectat";

      // Verificar l'estat actual de la sala
      this.checkRoomStatus();
      this.startTimeSync();
    });

    this.socket.on("disconnect", () => {
      console.log("Disconnected from server");
      this.isConnected = false;
      this.connectionStatus.classList.remove("connected", "syncing");
      this.connectionText.textContent = "Desconnectat";
    });

    // Resposta de temps per sincronització
    this.socket.on("sync-response", (data) => {
      this.handleTimeSyncResponse(data);
    });

    // Events de sala
    this.socket.on("room-setup", (data) => {
      this.room = data.room;
      this.showRoomConfigured();
    });

    this.socket.on("room-updated", (data) => {
      this.room = data.room;
      this.updateRoomDisplay();
    });

    // Events de participants
    this.socket.on("participant-joined", (data) => {
      if (this.room) {
        this.room.participants = data.participants;
        this.updateParticipants();
      }
    });

    this.socket.on("participant-left", (data) => {
      if (this.room) {
        this.room.participants =
          data.participants ||
          this.room.participants.filter((p) => p !== data.participantId);
        this.updateParticipants();
      }
    });

    // Events de sincronització
    this.socket.on("countdown-started", (data) => {
      this.startCountdown(data);
    });

    this.socket.on("playback-start", (data) => {
      this.startPlayback(data);
    });

    // Event de reconfiguració
    this.socket.on("room-reconfigured", () => {
      // PRIMER: Netejar intervals per evitar que el comptador es torni boig
      if (this.countdownInterval) {
        clearInterval(this.countdownInterval);
        this.countdownInterval = null;
      }

      // Reset estat local
      this.room = null;
      this.targetTime = null;

      this.showSetupForm();
    });
  }

  setupEventListeners() {
    // Gestió de temps
    this.targetTimeInput.addEventListener("change", () => this.validateForm());

    // Botons
    this.setupRoomBtn.addEventListener("click", () => this.setupRoom());
    this.reconfigureBtn.addEventListener("click", () => this.reconfigureRoom());
  }

  validateForm() {
    const hasTime = this.targetTimeInput.value !== "";
    const isConnected = this.isConnected;

    this.setupRoomBtn.disabled = !(hasTime && isConnected);
  }

  checkRoomStatus() {
    // Demanar informació de la sala al servidor
    fetch("/api/room")
      .then((response) => response.json())
      .then((data) => {
        if (data.room && data.room.targetTime) {
          this.room = data.room;
          this.showRoomConfigured();

          // Si la sala ja està en reproducció, mostrar el comptador de reproducció
          if (data.room.status === "playing") {
            this.startPlayback({
              targetTime: data.room.targetTime,
              startTime: data.room.startedAt,
            });
          } else if (data.room.status === "countdown") {
            // Si està en countdown, començar el countdown
            this.startCountdown({
              targetTime: data.room.targetTime,
              timeRemaining: data.room.targetTime - this.getServerTime(),
            });
          }
        } else {
          this.showSetupForm();
        }
      })
      .catch((error) => {
        console.error("Error checking room status:", error);
        this.showSetupForm();
      });
  }

  showSetupForm() {
    this.setupCard.classList.remove("hidden");
    this.roomCard.classList.add("hidden");

    // Reset countdown si estava actiu - CRÍTIC: netejar interval
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }

    // Amagar el countdown
    if (this.roomCountdown) {
      this.roomCountdown.classList.add("hidden");
      this.roomCountdown.classList.remove("playing");
    }

    // Reset estat de connexió
    this.connectionStatus.classList.remove("syncing", "playing");
    if (this.isConnected) {
      this.connectionText.textContent = "Connectat";
    }
  }

  showRoomConfigured() {
    this.setupCard.classList.add("hidden");
    this.roomCard.classList.remove("hidden");

    this.updateRoomDisplay();
  }

  updateRoomDisplay() {
    if (!this.room) return;

    // Actualitzar informació configurada
    if (this.room.targetTime) {
      const startDate = new Date(this.room.targetTime);
      this.configuredTime.textContent = startDate.toLocaleTimeString("ca-ES");
    }

    this.updateParticipants();
  }

  updateParticipants() {
    if (!this.room) return;

    this.participantCount.textContent = this.room.participants.length;

    this.participantsList.innerHTML = "";
    this.room.participants.forEach((participant) => {
      const element = document.createElement("div");
      element.className = "participant";

      // Si participant és un objecte amb informació detallada
      if (typeof participant === "object" && participant.id) {
        element.innerHTML = `
          <div class="participant-status"></div>
          <div class="participant-info">
            <div class="participant-file">${participant.mediaFileName}</div>
            <div class="participant-id">${participant.id}</div>
          </div>
        `;
      } else {
        // Retrocompatibilitat si encara rebem només l'ID
        element.innerHTML = `
          <div class="participant-status"></div>
          <span>${participant}</span>
        `;
      }

      this.participantsList.appendChild(element);
    });
  }

  updateTimeSuggestions() {
    const now = this.getServerTime();
    const suggestions = [];

    // Obtenir temps arrodonit al proper minut
    const roundedTime = new Date(now);
    roundedTime.setSeconds(0);
    roundedTime.setMilliseconds(0);
    // Si no estem al minut exacte, avançar al següent minut
    if (roundedTime.getTime() <= now) {
      roundedTime.setMinutes(roundedTime.getMinutes() + 1);
    }

    // Generar 6 propostes, una per cada minut exacte dels següents 6 minuts
    for (let i = 0; i < 6; i++) {
      // Crear una nova data pel minut actual + i
      const timeForSuggestion = new Date(roundedTime);
      timeForSuggestion.setMinutes(roundedTime.getMinutes() + i);

      // Afegir la proposta al minut exacte
      suggestions.push({
        time: timeForSuggestion.toLocaleTimeString("ca-ES", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        label: `+${i + 1 + " "}min`,
        value: timeForSuggestion.toString(),
      });
    }

    this.renderTimeSuggestions(suggestions);
  }

  renderTimeSuggestions(suggestions) {
    this.timeSuggestions.innerHTML = "";

    suggestions.forEach((suggestion) => {
      const element = document.createElement("div");
      element.className = "time-suggestion";
      element.innerHTML = `
        <div>${suggestion.time}</div>
        <div style="font-size: 0.8em; opacity: 0.7;">${suggestion.label}</div>
      `;

      element.addEventListener("click", () => {
        this.targetTimeInput.value = suggestion.time;
        this.targetTime = suggestion.value;

        // Actualitzar selecció visual
        this.timeSuggestions
          .querySelectorAll(".time-suggestion")
          .forEach((el) => {
            el.classList.remove("selected");
          });
        element.classList.add("selected");

        this.validateForm();
      });

      this.timeSuggestions.appendChild(element);
    });
  }

  setupRoom() {
    if (!this.targetTimeInput.value) {
      this.showNotification("Selecciona una hora d'inici", "error");
      return;
    }

    try {
      this.setupRoomBtn.disabled = true;
      this.setupRoomBtn.textContent = "Configurant...";

      // Obtenir la data d'avui en format YYYY-MM-DD
      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, "0");
      const day = String(today.getDate()).padStart(2, "0");
      const dateString = `${year}-${month}-${day}`;

      const targetDateTime = new Date(
        `${dateString}T${this.targetTimeInput.value}`
      );

      this.targetTime = targetDateTime.getTime();

      this.socket.emit("setup-room", {
        targetTime: this.targetTime,
      });
    } catch (error) {
      console.error("Error setting up room:", error);
      this.showNotification("Error configurant la sala", "error");
      this.setupRoomBtn.disabled = false;
      this.setupRoomBtn.textContent = "Configura la Sala";
    }
  }

  reconfigureRoom() {
    // PRIMER: Netejar intervals per evitar que el comptador es torni boig
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }

    // Emetre event al servidor per reconfigurar
    this.socket.emit("reconfigure-room");

    // Reset local
    this.room = null;
    this.targetTime = null;

    // Reset UI
    this.setupRoomBtn.disabled = false;
    this.setupRoomBtn.textContent = "Configura la Sala";
    this.targetTimeInput.value = "";

    // Netejar seleccions de temps suggerit
    this.timeSuggestions.querySelectorAll(".time-suggestion").forEach((el) => {
      el.classList.remove("selected");
    });

    // Reset estat visual del countdown
    if (this.roomCountdown) {
      this.roomCountdown.classList.add("hidden");
      this.roomCountdown.classList.remove("playing");
    }

    // Reset estat de connexió
    this.connectionStatus.classList.remove("syncing", "playing");
    if (this.isConnected) {
      this.connectionText.textContent = "Connectat";
    }
  }

  startCountdown(data) {
    // PRIMER: Netejar interval anterior per evitar duplicacions
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }

    // Mostrar el countdown dins de la sala configurada
    this.roomCountdown.classList.remove("hidden", "playing");
    this.roomCountdown.querySelector(".countdown-label").textContent =
      "fins a la sincronització";

    this.connectionStatus.classList.remove("playing");
    this.connectionStatus.classList.add("syncing");
    this.connectionText.textContent = "Sincronitzant";

    this.countdownInterval = setInterval(() => {
      const now = this.getServerTime();
      const timeRemaining = Math.max(0, data.targetTime - now);

      if (timeRemaining > 0) {
        const seconds = Math.ceil(timeRemaining / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;

        this.roomCountdownDisplay.textContent = `${minutes
          .toString()
          .padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
      } else {
        this.roomCountdownDisplay.textContent = "00:00";
        clearInterval(this.countdownInterval);
        this.countdownInterval = null;
      }
    }, 100);
  }

  startPlayback(data) {
    console.log("Starting playback", data);

    // PRIMER: Netejar interval anterior per evitar conflictes
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }

    // Canviar l'estil del countdown a mode reproducció
    this.roomCountdown.classList.remove("hidden");
    this.roomCountdown.classList.add("playing");

    // Canviar el text de la label
    this.roomCountdown.querySelector(".countdown-label").textContent =
      "Sala en reproducció";

    this.connectionStatus.classList.remove("syncing");
    this.connectionStatus.classList.add("playing");
    this.connectionText.textContent = "En reproducció";

    // Iniciar el comptador de temps de reproducció
    this.startPlaybackTimer(data);
  }

  startPlaybackTimer(data) {
    // CRÍTIC: Netejar interval anterior si existeix per evitar intervals múltiples
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }

    this.countdownInterval = setInterval(() => {
      const now = this.getServerTime();
      const elapsed = Math.max(0, now - data.targetTime);

      const seconds = Math.floor(elapsed / 1000);
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;

      this.roomCountdownDisplay.textContent = `${minutes
        .toString()
        .padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
    }, 100);
  }

  // Sincronització de temps
  startTimeSync() {
    // Sincronització inicial
    this.performTimeSync();

    // Sincronització periòdica
    setInterval(() => {
      this.performTimeSync();
    }, 30000);
  }

  performTimeSync() {
    if (!this.isConnected) return;

    const clientTime = Date.now();
    this.socket.emit("sync-request", {
      clientTime: clientTime,
      sequenceId: Math.random().toString(36).substr(2, 9),
    });
  }

  handleTimeSyncResponse(data) {
    const now = Date.now();
    const roundTripTime = now - data.clientRequestTime;
    const networkLatency = roundTripTime / 2;

    const estimatedServerTime = data.serverTime + networkLatency;
    this.serverTimeOffset = estimatedServerTime - now;

    console.log(
      `Time sync: offset=${this.serverTimeOffset}ms, latency=${networkLatency}ms`
    );
    this.offsetDisplay.textContent = `Offset: ${Math.round(
      this.serverTimeOffset
    )}ms`;
  }

  getServerTime() {
    return Date.now() + this.serverTimeOffset;
  }

  updateServerTimeDisplay() {
    if (this.isConnected) {
      const serverTime = this.getServerTime();
      const date = new Date(serverTime);
      this.serverTime.textContent = date.toLocaleTimeString("ca-ES");
    } else {
      this.serverTime.textContent = "--:--:--";
    }
  }

  showNotification(message, type = "info") {
    console.log(`[${type.toUpperCase()}] ${message}`);
    // Es podria implementar un sistema de notificacions visual aquí
  }
}

// Inicialitzar quan el DOM estigui carregat
document.addEventListener("DOMContentLoaded", () => {
  window.sessionClient = new SessionClient();
});
