/**
 * Client per unir-se a la sala de Sincroo
 */

class JoinClient {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.serverTimeOffset = 0;
    this.mediaFile = null;
    this.mediaPlayer = null;
    this.room = null;
    this.countdownInterval = null;
    this.isJoinedToRoom = false; // Estat de participant unit

    this.initializeElements();
    this.connect();
    this.setupEventListeners();

    // Actualitzar temps del servidor cada segon
    setInterval(() => this.updateServerTimeDisplay(), 1000);
  }

  initializeElements() {
    // Elements d'estat
    this.connectionStatus = document.getElementById("connectionStatus");
    this.connectionText = document.getElementById("connectionText");
    this.serverTime = document.getElementById("serverTime");
    this.offsetDisplay = document.getElementById("offsetDisplay");

    // Cards
    this.noRoomCard = document.getElementById("noRoomCard");
    this.roomCard = document.getElementById("roomCard");
    this.countdownCard = document.getElementById("countdownCard");

    // Elements de sala
    this.roomStatus = document.getElementById("roomStatus");
    this.startTime = document.getElementById("startTime");
    this.participantCount = document.getElementById("participantCount");

    // Fitxer
    this.mediaFileInput = document.getElementById("mediaFile");
    this.fileInputDisplay = document.getElementById("fileInputDisplay");

    // Botons
    this.joinBtn = document.getElementById("joinBtn");
    this.leaveBtn = document.getElementById("leaveBtn");

    // Countdown separat (original)
    this.countdownDisplay = document.getElementById("countdownDisplay");

    // Countdown dins de la sala
    this.roomCountdown = document.getElementById("roomCountdown");
    this.roomCountdownDisplay = document.getElementById("roomCountdownDisplay");

    // Reproductor
    this.mediaPlayer = document.getElementById("mediaPlayer");
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

      // Demanar informació de la sala
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

    // Informació de la sala
    this.socket.on("room-joined", (data) => {
      this.room = data.room;
      this.isJoinedToRoom = true; // Marcar com unit a la sala
      this.updateRoomDisplay();
      this.updateUIState(); // Actualitzar interfície
      this.updateCountdownJoinState(); // Actualitzar estat visual del countdown

      // Si ja està reproduint, unir-se immediatament
      if (this.room.status === "playing") {
        this.joinPlayback(data.room.currentPosition || 0);
      }
    });

    this.socket.on("room-updated", (data) => {
      this.room = data.room;
      this.updateRoomDisplay();

      // Gestionar canvis d'estat de la sala
      this.updateRoomState();
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
      // Si no tenim informació de la sala, demanar-la primer
      if (!this.room || !this.room.targetTime) {
        this.checkRoomStatus().then(() => {
          this.startCountdown(data);
        });
      } else {
        this.startCountdown(data);
      }
    });

    this.socket.on("playback-start", (data) => {
      // Si no tenim informació de la sala, demanar-la primer
      if (!this.room || !this.room.targetTime) {
        this.checkRoomStatus().then(() => {
          this.startPlayback(data);
        });
      } else {
        this.startPlayback(data);
      }
    });

    // Event de reconfiguració
    this.socket.on("room-reconfigured", () => {
      // Reset dels intervals i estats
      if (this.countdownInterval) {
        clearInterval(this.countdownInterval);
        this.countdownInterval = null;
      }

      // Reset indicadors d'estat
      this.connectionStatus.classList.remove("syncing", "playing");
      this.connectionText.textContent = "Connectat";

      // Parar reproductor si estava actiu
      if (this.mediaPlayer && !this.mediaPlayer.paused) {
        this.mediaPlayer.pause();
        this.mediaPlayer.currentTime = 0;
      }

      // Recarregar l'estat de la sala
      this.checkRoomStatus();
    });
  }

  setupEventListeners() {
    // Gestió de fitxers
    this.mediaFileInput.addEventListener("change", (e) =>
      this.onFileSelected(e)
    );

    // Botó d'unir-se
    this.joinBtn.addEventListener("click", () => this.joinRoom());

    // Botó de sortir
    this.leaveBtn.addEventListener("click", () => this.leaveRoom());
  }

  setupMediaPlayerListeners() {
    if (!this.mediaPlayer) return;

    // Event de play del reproductor - sincronitzar automàticament
    this.mediaPlayer.addEventListener("play", () => {
      if (this.isJoinedToRoom && this.room && this.room.status === "playing") {
        // Calcular posició actual sincronitzada i ajustar
        this.syncPlayerPosition();
      }
      // Amagar opció de resincronització si estava visible
      this.hideResyncOption();
    });

    // Event de pausa del reproductor
    this.mediaPlayer.addEventListener("pause", () => {
      if (this.isJoinedToRoom && this.room && this.room.status === "playing") {
        // Mostrar notificació que pot resincronitzar
        this.showResyncOption();
      }
    });
  }

  onFileSelected(event) {
    // Si ja està unit a la sala, no permetre canviar fitxer
    if (this.isJoinedToRoom) {
      event.preventDefault();
      this.mediaFileInput.value = ""; // Reset del input
      alert(
        "No pots canviar el fitxer mentre estàs unit a la sala. Surt de la sala primer."
      );
      return;
    }

    const file = event.target.files[0];
    if (!file) {
      this.mediaFile = null;
      this.fileInputDisplay.textContent =
        "📁 Tria el mateix fitxer que es reproduirà";
      this.fileInputDisplay.classList.remove("has-file");

      // Reset estils del reproductor
      if (this.mediaPlayer) {
        this.mediaPlayer.style.display = "none";
        this.mediaPlayer.classList.remove("audio-only");
        this.mediaPlayer.style.height = "auto";
        this.mediaPlayer.style.maxHeight = "none";
      }

      this.updateJoinButton();
      return;
    }

    this.mediaFile = file;
    this.fileInputDisplay.textContent = `✅ ${file.name}`;
    this.fileInputDisplay.classList.add("has-file");

    // Preparar el reproductor
    this.setupMediaPlayer(file);
    this.updateJoinButton();
  }
  setupMediaPlayer(file) {
    const url = URL.createObjectURL(file);
    this.mediaPlayer.src = url;
    this.mediaPlayer.style.display = "block";
    this.mediaPlayer.load();

    // Ajustar l'estil segons el tipus de fitxer
    this.adjustPlayerForMediaType(file);

    // Configurar listeners del reproductor
    this.setupMediaPlayerListeners();
  }

  adjustPlayerForMediaType(file) {
    const isAudio = file.type.startsWith("audio/");

    if (isAudio) {
      // Per fitxers d'àudio, fer el reproductor més compacte
      this.mediaPlayer.style.height = "60px";
      this.mediaPlayer.style.maxHeight = "60px";
      this.mediaPlayer.style.width = "100%";
      this.mediaPlayer.classList.add("audio-only");

      console.log("📻 Audio file detected - using compact player layout");
    } else {
      // Per fitxers de vídeo, usar l'estil complet
      this.mediaPlayer.style.height = "auto";
      this.mediaPlayer.style.maxHeight = "none";
      this.mediaPlayer.style.width = "100%";
      this.mediaPlayer.classList.remove("audio-only");

      console.log("🎬 Video file detected - using full player layout");
    }
  }

  updateJoinButton() {
    const hasFile = this.mediaFile !== null;
    const hasConfiguredRoom = this.room && this.room.targetTime;
    const isConnected = this.isConnected;

    // Si ja està unit, deshabilitar botó d'unir-se
    if (this.isJoinedToRoom) {
      this.joinBtn.disabled = true;
      this.joinBtn.textContent = "✅ Unit a la sala";
      return;
    }

    this.joinBtn.disabled = !(hasFile && hasConfiguredRoom && isConnected);

    // Actualitzar text del botó segons l'estat
    if (!this.room) {
      this.joinBtn.textContent = "No hi ha sala activa";
    } else if (!this.room.targetTime) {
      this.joinBtn.textContent = "Esperant configuració...";
    } else if (!hasFile) {
      this.joinBtn.textContent = "Selecciona un fitxer";
    } else if (!isConnected) {
      this.joinBtn.textContent = "Connectant...";
    } else {
      this.joinBtn.textContent = "Uneix-te a la sala";
    }
  }
  checkRoomStatus() {
    // Demanar informació de la sala al servidor
    return fetch("/api/room")
      .then((response) => response.json())
      .then((data) => {
        if (data.room) {
          this.room = data.room;
          this.updateRoomDisplay();
          // Utilizar la función centralizada para gestionar el estado
          this.updateRoomState();
        } else {
          this.showNoRoom();
        }
      })
      .catch((error) => {
        console.error("Error checking room status:", error);
        this.showNoRoom();
      });
  }

  showNoRoom() {
    this.noRoomCard.classList.remove("hidden");
    this.roomCard.classList.add("hidden");
    this.countdownCard.classList.add("hidden");

    // Reset de l'estat d'unió
    this.isJoinedToRoom = false;

    // Reset dels intervals
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }

    // Reset indicadors d'estat
    this.connectionStatus.classList.remove("syncing", "playing");
    if (this.isConnected) {
      this.connectionText.textContent = "Connectat";
    }

    // Parar reproductor si estava actiu
    if (this.mediaPlayer && !this.mediaPlayer.paused) {
      this.mediaPlayer.pause();
      this.mediaPlayer.currentTime = 0;
    }

    // Reset estils del reproductor
    if (this.mediaPlayer) {
      this.mediaPlayer.style.display = "none";
      this.mediaPlayer.classList.remove("audio-only");
    }

    // Reset countdown
    if (this.roomCountdown) {
      this.roomCountdown.classList.add("hidden");
      this.roomCountdown.classList.remove("playing", "waiting", "not-joined");
    }

    // Amagar botó de resincronització
    this.hideResyncOption();

    // Actualitzar interfície
    this.updateUIState();
  }

  updateRoomDisplay() {
    if (!this.room) {
      this.showNoRoom();
      return;
    }

    // Si la sala no té targetTime configurat, mostrar que espera configuració
    if (!this.room.targetTime) {
      // Mostrar missatge d'espera
      this.roomStatus.textContent = "Esperant configuració de la sala...";
      this.roomStatus.style.color = "#6c757d";
      this.startTime.textContent = "--:--:--";

      // Mostrar countdown en estat d'espera per mantenir layout consistent
      this.roomCountdown.classList.remove("playing", "waiting", "not-joined");
      this.roomCountdown.classList.add("waiting");
      this.roomCountdownDisplay.textContent = "Espera";
      this.roomCountdown.querySelector(".countdown-label").textContent =
        "S'està configurant la sala";

      this.updateParticipants();
      this.updateJoinButton();
      this.updateUIState(); // Actualitzar interfície
      this.updateCountdownJoinState(); // Actualitzar estat visual del countdown
      return;
    }

    this.noRoomCard.classList.add("hidden");
    this.roomCard.classList.remove("hidden");

    // Actualitzar informació de la sala
    const startDate = new Date(this.room.targetTime);
    this.startTime.textContent = startDate.toLocaleTimeString("ca-ES");

    // Status de la sala amb missatges més clars
    if (this.room.status === "waiting") {
      this.roomStatus.textContent = "Sala configurada, esperant inici";
      this.roomStatus.style.color = "#313131";
    } else if (this.room.status === "countdown") {
      this.roomStatus.textContent = "A punt de començar...";
      this.roomStatus.style.color = "#313131";
    } else if (this.room.status === "playing") {
      this.roomStatus.textContent = "Sala en reproducció";
      this.roomStatus.style.color = "#28a745";
    }
    this.updateParticipants();
    this.updateJoinButton();
    this.updateUIState(); // Actualitzar interfície
    this.updateCountdownJoinState(); // Actualitzar estat visual del countdown
  }

  updateUIState() {
    // Gestionar visibilitat dels botons i accés als controls
    if (this.isJoinedToRoom) {
      // Amagar botó d'unir-se i mostrar botó de sortir
      this.joinBtn.classList.add("hidden");
      this.leaveBtn.classList.remove("hidden");

      // Deshabilitar input de fitxer visualment
      this.mediaFileInput.disabled = true;
      this.fileInputDisplay.style.opacity = "0.6";
      this.fileInputDisplay.style.pointerEvents = "none";
    } else {
      // Mostrar botó d'unir-se i amagar botó de sortir
      this.joinBtn.classList.remove("hidden");
      this.leaveBtn.classList.add("hidden");

      // Habilitar input de fitxer
      this.mediaFileInput.disabled = false;
      this.fileInputDisplay.style.opacity = "1";
      this.fileInputDisplay.style.pointerEvents = "auto";
    }
  }

  updateParticipants() {
    if (!this.room) return;

    this.participantCount.textContent = this.room.participants.length;
    // Ja no mostrem la llista de participants, només el recompte
  }

  updateRoomState() {
    if (!this.room) return;

    // Netejar intervals anteriors per evitar duplicacions
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }

    // Gestionar l'estat actual de la sala
    if (this.room.status === "countdown" && this.room.targetTime) {
      this.startRoomCountdown({
        targetTime: this.room.targetTime,
        timeRemaining: this.room.targetTime - this.getServerTime(),
      });
    } else if (this.room.status === "playing" && this.room.targetTime) {
      this.startPlaybackTimer({
        targetTime: this.room.targetTime,
        startTime: this.room.startedAt,
      });
    } else if (this.room.status === "waiting") {
      // Mostrar countdown en estat d'espera
      if (this.roomCountdown) {
        this.roomCountdown.classList.remove("hidden", "playing");
        this.roomCountdown.classList.add("waiting");
      }

      // Reset indicadors d'estat
      this.connectionStatus.classList.remove("syncing", "playing");
      if (this.isConnected) {
        this.connectionText.textContent = "Connectat";
      }
      // Amagar botó de resincronització ja que no estem reproduint
      this.hideResyncOption();
    }

    // Aplicar sempre l'estat visual segons si està unit o no
    this.updateCountdownJoinState();
  }

  updateCountdownJoinState() {
    if (!this.roomCountdown) return;

    // Netejar i aplicar classe segons estat d'unió
    this.roomCountdown.classList.remove("not-joined");

    if (!this.isJoinedToRoom) {
      this.roomCountdown.classList.add("not-joined");
    }
  }

  startRoomCountdown(data) {
    // Netejar intervals anteriors
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }

    // Mostrar el countdown dins de la sala
    this.roomCountdown.classList.remove("hidden", "playing", "waiting");
    this.roomCountdown.querySelector(".countdown-label").textContent =
      "fins a la sincronització";

    // Actualitzar indicador d'estat
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

  startPlaybackTimer(data) {
    // Netejar intervals anteriors
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }

    // Canviar l'estil del countdown a mode reproducció
    this.roomCountdown.classList.remove("hidden", "waiting");
    this.roomCountdown.classList.add("playing");

    // Canviar el text de la label
    this.roomCountdown.querySelector(".countdown-label").textContent =
      "Sala en reproducció";

    // Actualitzar indicador d'estat
    this.connectionStatus.classList.remove("syncing");
    this.connectionStatus.classList.add("playing");
    this.connectionText.textContent = "En reproducció";

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

  joinRoom() {
    if (!this.mediaFile || !this.room || this.isJoinedToRoom) return;

    this.socket.emit("join-room", {
      mediaFileName: this.mediaFile.name,
    });
    this.joinBtn.disabled = true;
    this.joinBtn.textContent = "🔄 Unint-se a la sala...";
  }

  leaveRoom() {
    if (!this.isJoinedToRoom) return;

    // Prompt de confirmació
    const confirmLeave = confirm("Estàs segur que vols sortir de la sala?");

    if (!confirmLeave) return;

    // Sortir de la sala
    this.isJoinedToRoom = false;
    this.socket.emit("leave-room");

    // Reset de l'estat del reproductor
    if (this.mediaPlayer && !this.mediaPlayer.paused) {
      this.mediaPlayer.pause();
      this.mediaPlayer.currentTime = 0;
    }

    // Reset de l'estat visual
    this.connectionStatus.classList.remove("syncing", "playing");
    if (this.isConnected) {
      this.connectionText.textContent = "Connectat";
    }

    // Reset intervals
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }

    // Amagar botó de resincronització si estava visible
    this.hideResyncOption();

    // Actualitzar interfície
    this.updateUIState();
    this.updateJoinButton();
    this.updateCountdownJoinState(); // Actualitzar estat visual del countdown

    // Recarregar estat de la sala
    this.checkRoomStatus();
  }

  showResyncOption() {
    // Crear o mostrar botó de resincronització
    let resyncBtn = document.getElementById("resyncBtn");

    if (!resyncBtn) {
      resyncBtn = document.createElement("button");
      resyncBtn.id = "resyncBtn";
      resyncBtn.className = "btn btn-warning resync-btn";
      resyncBtn.innerHTML = "Resincronitza i reprodueix";
      resyncBtn.addEventListener("click", () => this.resyncWithRoom());

      // Insertar després del reproductor
      this.mediaPlayer.parentNode.insertBefore(
        resyncBtn,
        this.mediaPlayer.nextSibling
      );
    }

    resyncBtn.classList.remove("hidden");
    resyncBtn.style.display = "block";
  }

  hideResyncOption() {
    const resyncBtn = document.getElementById("resyncBtn");
    if (resyncBtn) {
      resyncBtn.classList.add("hidden");
      resyncBtn.style.display = "none";
    }
  }

  resyncWithRoom() {
    if (!this.isJoinedToRoom || !this.room || this.room.status !== "playing") {
      return;
    }

    // Calcular posició actual sincronitzada
    const now = this.getServerTime();
    const elapsed = Math.max(0, now - this.room.targetTime);
    const syncPosition = elapsed / 1000;

    console.log(
      "🔄 Manual resync with room at position:",
      syncPosition.toFixed(2),
      "seconds"
    );

    // Mostrar missatge temporal
    const resyncBtn = document.getElementById("resyncBtn");
    if (resyncBtn) {
      const originalText = resyncBtn.innerHTML;
      resyncBtn.innerHTML = "🔄 Sincronitzant...";
      resyncBtn.disabled = true;

      setTimeout(() => {
        if (resyncBtn) {
          resyncBtn.innerHTML = originalText;
          resyncBtn.disabled = false;
        }
      }, 1000);
    }

    // Posicionar i reproduir automàticament
    this.mediaPlayer.currentTime = Math.max(0, syncPosition);
    this.mediaPlayer.play().catch((error) => {
      console.error("Error resynchronizing playback:", error);
    });

    // Amagar botó de resincronització després d'un moment
    setTimeout(() => {
      this.hideResyncOption();
    }, 1500);
  }

  syncPlayerPosition() {
    if (!this.isJoinedToRoom || !this.room || this.room.status !== "playing") {
      return;
    }

    // Calcular posició actual sincronitzada
    const now = this.getServerTime();
    const elapsed = Math.max(0, now - this.room.targetTime);
    const syncPosition = elapsed / 1000;

    // Verificar si la diferència és significativa (més de 1 segon)
    const currentPosition = this.mediaPlayer.currentTime;
    const timeDiff = Math.abs(currentPosition - syncPosition);

    if (timeDiff > 1) {
      console.log(
        `🔄 Auto-syncing: current=${currentPosition.toFixed(
          2
        )}s, sync=${syncPosition.toFixed(2)}s, diff=${timeDiff.toFixed(2)}s`
      );

      // Ajustar posició sense pausar la reproducció
      this.mediaPlayer.currentTime = Math.max(0, syncPosition);
    }
  }

  startCountdown(data) {
    // Actualitzar la informació de la sala si no la tenim
    if (!this.room || !this.room.targetTime) {
      this.room = {
        ...this.room,
        targetTime: data.targetTime,
        status: "countdown",
      };
      this.updateRoomDisplay();
    }

    // Utilitzar la funció centralitzada
    this.updateRoomState();
  }

  startPlayback(data) {
    console.log("🎵 Starting synchronized playback", data);

    // Actualitzar la informació de la sala si no la tenim
    if (!this.room || !this.room.targetTime) {
      this.room = {
        ...this.room,
        targetTime: data.targetTime,
        status: "playing",
        startedAt: data.startTime,
      };
      this.updateRoomDisplay();
    }

    // Utilitzar la funció centralitzada
    this.updateRoomState();

    if (this.mediaPlayer && this.mediaPlayer.src) {
      // Calcular posició si és inici immediat o tard
      let seekPosition = 0;

      if (data.immediate && data.seekTo) {
        seekPosition = data.seekTo;
      } else if (data.immediate) {
        const elapsed = this.getServerTime() - data.targetTime;
        seekPosition = elapsed / 1000;
      }

      // Posicionar i reproduir
      this.mediaPlayer.currentTime = Math.max(0, seekPosition);
      this.mediaPlayer.play().catch((error) => {
        console.error("Error starting playback:", error);
      });
    }
  }

  joinPlayback(currentPosition) {
    console.log(
      "🎵 Joining ongoing synchronized playback at position:",
      currentPosition
    );

    // Utilitzar la funció centralitzada si tenim informació de sala
    if (this.room && this.room.targetTime) {
      this.updateRoomState();
    }

    if (this.mediaPlayer && this.mediaPlayer.src) {
      this.mediaPlayer.currentTime = Math.max(0, currentPosition);
      this.mediaPlayer.play().catch((error) => {
        console.error("Error joining playback:", error);
      });
    }
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
}

// Inicialitzar quan el DOM estigui carregat
document.addEventListener("DOMContentLoaded", () => {
  window.joinClient = new JoinClient();
});
