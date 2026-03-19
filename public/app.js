(function () {
  "use strict";

  var storageKeys = {
    color: "snaketv-player-color",
    name: "snaketv-player-name"
  };
  var colorPalette = [
    "#ff6b6b",
    "#34c759",
    "#00a6fb",
    "#ffd166",
    "#c77dff",
    "#ff8fab",
    "#00c2a8",
    "#f97316"
  ];
  var heartbeatId = null;
  var reconnectTimer = null;
  var countdownFrame = 0;
  var roundTimerFrame = 0;
  var animationFrameId = 0;
  var resultPhaseTimer = 0;
  var resultPhaseDeadline = 0;
  var resizeObserver = null;
  var resizeTimers = [];
  var audioContext = null;
  var supportsTouchUi = false;
  var state = {
    connected: false,
    focusMode: false,
    previousRoom: null,
    ranking: null,
    roomsOverview: [],
    room: null,
    roomUpdatedAt: 0,
    selectedColor: colorPalette[0],
    socket: null,
    statusText: "Conectando ao servidor...",
    you: null
  };

  var refs = {};
  var canvas = null;
  var ctx = null;
  var boardSize = 640;
  var keyToDirection = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    w: "up",
    W: "up",
    s: "down",
    S: "down",
    a: "left",
    A: "left",
    d: "right",
    D: "right"
  };

  window.addEventListener("load", init);
  window.addEventListener("resize", scheduleCanvasResize);
  window.addEventListener("orientationchange", scheduleCanvasResize);
  window.addEventListener("fullscreenchange", scheduleCanvasResize);
  document.addEventListener("keydown", handleKeyDown);

  function init() {
    cacheDom();
    syncTouchUi();
    syncHelpRules();
    buildColorPicker();
    hydrateInputs();
    bindEvents();
    setupResizeTracking();
    scheduleCanvasResize();
    startCanvasLoop();
    connect();
    render();
  }

  function cacheDom() {
    refs.colorPicker = document.getElementById("colorPicker");
    refs.connectionBadge = document.getElementById("connectionBadge");
    refs.copyLinkButton = document.getElementById("copyLinkButton");
    refs.createRoomButton = document.getElementById("createRoomButton");
    refs.closeHelpButton = document.getElementById("closeHelpButton");
    refs.focusLeaveButton = document.getElementById("focusLeaveButton");
    refs.gameOverlay = document.getElementById("gameOverlay");
    refs.gameStage = document.getElementById("gameStage");
    refs.gameSubtitle = document.getElementById("gameSubtitle");
    refs.gameTitle = document.getElementById("gameTitle");
    refs.helpButton = document.getElementById("helpButton");
    refs.helpModal = document.getElementById("helpModal");
    refs.helpRulesList = document.getElementById("helpRulesList");
    refs.helpRulesTemplate = document.getElementById("helpRulesTemplate");
    refs.homePanel = document.getElementById("homePanel");
    refs.hudRoomPill = document.getElementById("hudRoomPill");
    refs.hudRulePill = document.getElementById("hudRulePill");
    refs.hudStatusPill = document.getElementById("hudStatusPill");
    refs.hudTimerPill = document.getElementById("hudTimerPill");
    refs.joinRoomButton = document.getElementById("joinRoomButton");
    refs.leaveButton = document.getElementById("leaveButton");
    refs.mobileControls = document.getElementById("mobileControls");
    refs.mobileShootButton = document.getElementById("mobileShootButton");
    refs.nameInput = document.getElementById("nameInput");
    refs.overlayCountdown = document.getElementById("overlayCountdown");
    refs.overlayLabel = document.getElementById("overlayLabel");
    refs.overlayText = document.getElementById("overlayText");
    refs.overlayTitle = document.getElementById("overlayTitle");
    refs.playerCountText = document.getElementById("playerCountText");
    refs.playerList = document.getElementById("playerList");
    refs.rankingCard = document.getElementById("rankingCard");
    refs.rankingList = document.getElementById("rankingList");
    refs.rankingResetText = document.getElementById("rankingResetText");
    refs.rankingSelfText = document.getElementById("rankingSelfText");
    refs.restartGameButton = document.getElementById("restartGameButton");
    refs.roomHelpButton = document.getElementById("roomHelpButton");
    refs.roomCodeInput = document.getElementById("roomCodeInput");
    refs.roomCodeText = document.getElementById("roomCodeText");
    refs.roomDirectoryCard = document.getElementById("roomDirectoryCard");
    refs.roomDirectoryCount = document.getElementById("roomDirectoryCount");
    refs.roomDirectoryList = document.getElementById("roomDirectoryList");
    refs.roomLeaveButton = document.getElementById("roomLeaveButton");
    refs.roomPanel = document.getElementById("roomPanel");
    refs.scoreStrip = document.getElementById("scoreStrip");
    refs.shareLinkText = document.getElementById("shareLinkText");
    refs.startGameButton = document.getElementById("startGameButton");
    refs.statusText = document.getElementById("statusText");
    canvas = document.getElementById("gameCanvas");
    ctx = canvas.getContext("2d");
  }

  function syncTouchUi() {
    supportsTouchUi = !!(
      (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) ||
      navigator.maxTouchPoints > 0 ||
      "ontouchstart" in window
    );

    document.body.classList.toggle("touch-device", supportsTouchUi);
  }

  function syncHelpRules() {
    var sourceRules = refs.helpRulesTemplate;

    if (!refs.helpRulesList || !sourceRules) {
      return;
    }

    refs.helpRulesList.innerHTML = sourceRules.innerHTML;
  }

  function buildColorPicker() {
    refs.colorPicker.innerHTML = colorPalette
      .map(function (color) {
        return [
          '<button class="color-option" type="button" role="radio" aria-label="',
          color,
          '" data-color="',
          color,
          '" style="--swatch:',
          color,
          '"></button>'
        ].join("");
      })
      .join("");
  }

  function setupResizeTracking() {
    if (typeof ResizeObserver !== "function" || !refs.gameStage) {
      return;
    }

    resizeObserver = new ResizeObserver(function () {
      scheduleCanvasResize();
    });

    resizeObserver.observe(refs.gameStage);
  }

  function hydrateInputs() {
    var savedName = "";
    var savedColor = "";
    var urlCode = "";

    try {
      savedName = window.localStorage.getItem(storageKeys.name) || "";
      savedColor = window.localStorage.getItem(storageKeys.color) || "";
    } catch (error) {
      savedName = "";
      savedColor = "";
    }

    try {
      urlCode = new URLSearchParams(window.location.search).get("room") || "";
    } catch (error) {
      urlCode = "";
    }

    refs.nameInput.value = savedName;
    refs.roomCodeInput.value = cleanRoomCode(urlCode);
    selectColor(savedColor || colorPalette[0], false);
  }

  function bindEvents() {
    refs.colorPicker.addEventListener("click", function (event) {
      var target = event.target;

      if (!target || !target.dataset || !target.dataset.color) {
        return;
      }

      selectColor(target.dataset.color, true);
    });

    refs.createRoomButton.addEventListener("click", function () {
      closeHelpModal();
      requestImmersiveMode();
      send({
        type: "create_room",
        color: state.selectedColor,
        name: getPlayerName()
      });
    });

    refs.joinRoomButton.addEventListener("click", function () {
      closeHelpModal();
      requestImmersiveMode();
      send({
        type: "join_room",
        code: cleanRoomCode(refs.roomCodeInput.value),
        color: state.selectedColor,
        name: getPlayerName()
      });
    });

    refs.helpButton.addEventListener("click", openHelpModal);
    refs.roomHelpButton.addEventListener("click", openHelpModal);
    refs.closeHelpButton.addEventListener("click", closeHelpModal);

    refs.helpModal.addEventListener("click", function (event) {
      var target = event.target;

      if (target && target.dataset && target.dataset.helpClose === "true") {
        closeHelpModal();
      }
    });

    refs.copyLinkButton.addEventListener("click", copyShareLink);

    refs.startGameButton.addEventListener("click", function () {
      requestImmersiveMode();
      send({ type: "start_game" });
    });

    refs.restartGameButton.addEventListener("click", function () {
      requestImmersiveMode();
      send({ type: "start_game" });
    });

    refs.leaveButton.addEventListener("click", function () {
      send({ type: "leave_room" });
    });

    refs.roomLeaveButton.addEventListener("click", function () {
      send({ type: "leave_room" });
    });

    Array.prototype.forEach.call(
      document.querySelectorAll("[data-direction]"),
      function (button) {
        button.addEventListener("pointerdown", function (event) {
          event.preventDefault();
          event.stopPropagation();
          primeAudio();

          send({
            type: "steer",
            direction: button.dataset.direction
          });
        });
      }
    );

    refs.mobileShootButton.addEventListener("pointerdown", function (event) {
      event.preventDefault();
      event.stopPropagation();
      primeAudio();
      sendShoot();
    });

    refs.focusLeaveButton.addEventListener("click", function () {
      send({ type: "leave_room" });
    });

    refs.gameStage.addEventListener("pointerdown", handleStagePointerDown);

    refs.roomCodeInput.addEventListener("input", function (event) {
      event.target.value = cleanRoomCode(event.target.value);
    });

    refs.nameInput.addEventListener("change", persistName);
    refs.nameInput.addEventListener("blur", persistName);
  }

  function connect() {
    if (
      state.socket &&
      (state.socket.readyState === WebSocket.OPEN ||
        state.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    clearTimeout(reconnectTimer);
    updateStatus(false, "Conectando ao servidor...");

    var protocol = window.location.protocol === "https:" ? "wss://" : "ws://";
    var socket = new WebSocket(protocol + window.location.host);
    state.socket = socket;

    socket.addEventListener("open", function () {
      updateStatus(true, "Servidor conectado. Crie ou entre em uma sala.");
      startHeartbeat();
    });

    socket.addEventListener("message", function (event) {
      handleMessage(event.data);
    });

    socket.addEventListener("close", function () {
      stopHeartbeat();
      stopCountdownLoop();
      stopRoundTimerLoop();
      stopResultPhaseTimer();
      state.connected = false;
      state.previousRoom = null;
      state.roomsOverview = [];
      state.room = null;
      state.roomUpdatedAt = 0;
      state.you = null;
      updateStatus(false, "Conexao perdida. Tentando reconectar...");
      render();
      reconnectTimer = window.setTimeout(connect, 1600);
    });

    socket.addEventListener("error", function () {
      updateStatus(false, "Erro de conexao com o servidor.");
    });
  }

  function handleMessage(rawMessage) {
    var payload;

    try {
      payload = JSON.parse(rawMessage);
    } catch (error) {
      return;
    }

    if (payload.type === "connected") {
      updateStatus(true, "Servidor conectado. Crie ou entre em uma sala.");
      render();
      return;
    }

    if (payload.type === "pong") {
      return;
    }

    if (payload.type === "error") {
      updateStatus(state.connected, payload.message || "Ocorreu um erro.");
      return;
    }

    if (payload.type === "rooms_overview") {
      state.ranking = payload.ranking || state.ranking;
      state.roomsOverview = Array.isArray(payload.rooms) ? payload.rooms : [];
      render();
      return;
    }

    if (payload.type === "left_room") {
      stopCountdownLoop();
      stopRoundTimerLoop();
      stopResultPhaseTimer();
      state.previousRoom = null;
      state.room = null;
      state.roomUpdatedAt = 0;
      state.you = null;
      syncRoomCodeToUrl();
      updateStatus(state.connected, "Voce saiu da sala.");
      render();
      return;
    }

    if (payload.type === "room_state") {
      var nextRoom = payload.room || null;
      var nextYou = payload.you || state.you || null;

      playLocalStateSounds(state.room, nextRoom, nextYou);
      state.previousRoom = shouldInterpolateRoomState(state.room, nextRoom) ? state.room : null;
      state.room = nextRoom;
      state.roomUpdatedAt = Date.now();
      state.you = nextYou;
      state.ranking = nextRoom && nextRoom.ranking ? nextRoom.ranking : state.ranking;
      updateStatus(true, statusFromRoom(state.room));
      syncResultPhaseTimer();
      syncRoomCodeToUrl();
      render();

      if (shouldFocusGame()) {
        requestImmersiveMode();
      }
    }
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatId = window.setInterval(function () {
      send({ type: "ping" });
    }, 15000);
  }

  function stopHeartbeat() {
    if (heartbeatId) {
      window.clearInterval(heartbeatId);
      heartbeatId = null;
    }
  }

  function stopCountdownLoop() {
    if (countdownFrame) {
      window.clearInterval(countdownFrame);
      countdownFrame = 0;
    }
  }

  function stopRoundTimerLoop() {
    if (roundTimerFrame) {
      window.clearInterval(roundTimerFrame);
      roundTimerFrame = 0;
    }
  }

  function stopResultPhaseTimer() {
    if (resultPhaseTimer) {
      window.clearTimeout(resultPhaseTimer);
      resultPhaseTimer = 0;
    }

    resultPhaseDeadline = 0;
  }

  function syncResultPhaseTimer() {
    var room = state.room;

    if (!room || room.status !== "over" || !isWinnerRevealPhase(room)) {
      stopResultPhaseTimer();
      return;
    }

    if (resultPhaseDeadline === room.showGameOverAt && resultPhaseTimer) {
      return;
    }

    stopResultPhaseTimer();
    resultPhaseDeadline = room.showGameOverAt;
    resultPhaseTimer = window.setTimeout(function () {
      resultPhaseTimer = 0;
      resultPhaseDeadline = 0;
      updateStatus(state.connected, statusFromRoom(state.room));
      render();
    }, Math.max(30, room.showGameOverAt - Date.now() + 30));
  }

  function startCountdownLoop() {
    if (countdownFrame) {
      return;
    }

    updateCountdownDisplay();
    countdownFrame = window.setInterval(updateCountdownDisplay, 120);
  }

  function startRoundTimerLoop() {
    if (roundTimerFrame) {
      return;
    }

    updateRoundTimerDisplay();
    roundTimerFrame = window.setInterval(updateRoundTimerDisplay, 200);
  }

  function updateCountdownDisplay() {
    if (!state.room || state.room.status !== "countdown" || !state.room.countdownEndsAt) {
      stopCountdownLoop();
      return;
    }

    var secondsLeft = getCountdownSeconds(state.room.countdownEndsAt);
    refs.overlayCountdown.textContent = String(secondsLeft);
    refs.hudStatusPill.textContent = "Comeca em " + secondsLeft + "s";
  }

  function updateRoundTimerDisplay() {
    if (!state.room || state.room.status !== "playing" || !state.room.roundEndsAt) {
      stopRoundTimerLoop();
      return;
    }

    refs.hudTimerPill.textContent = formatRoundTime(getRoundMsLeft(state.room.roundEndsAt));
  }

  function handleKeyDown(event) {
    primeAudio();

    if (event.key === "Escape" && isHelpModalOpen()) {
      event.preventDefault();
      closeHelpModal();
      return;
    }

    if (!state.room || state.room.status !== "playing") {
      return;
    }

    if (isShootKey(event)) {
      event.preventDefault();

      if (!event.repeat) {
        sendShoot();
      }

      return;
    }

    var direction = keyToDirection[event.key];

    if (!direction) {
      return;
    }

    event.preventDefault();
    send({
      type: "steer",
      direction: direction
    });
  }

  function handleStagePointerDown(event) {
    primeAudio();

    if (event.button !== 0 || !state.focusMode || event.pointerType !== "mouse") {
      return;
    }

    sendShoot();
  }

  function isShootKey(event) {
    return (
      event.key === "Enter" ||
      event.key === "OK" ||
      event.key === "Select" ||
      event.key === " " ||
      event.key === "Spacebar" ||
      event.code === "Enter" ||
      event.code === "NumpadEnter" ||
      event.code === "Space" ||
      event.keyCode === 13 ||
      event.keyCode === 32
    );
  }

  function sendShoot() {
    var selfPlayer = getSelfPlayer();

    if (
      !state.room ||
      state.room.status !== "playing" ||
      !selfPlayer ||
      !selfPlayer.alive ||
      !selfPlayer.segments ||
      selfPlayer.segments.length < 4
    ) {
      return;
    }

    if (getPlayerAvailableShots(selfPlayer) <= 0) {
      return;
    }

    send({ type: "shoot" });
  }

  function selectColor(color, shouldPersist) {
    if (colorPalette.indexOf(color) === -1) {
      color = colorPalette[0];
    }

    state.selectedColor = color;

    Array.prototype.forEach.call(refs.colorPicker.children, function (button) {
      var isSelected = button.dataset.color === color;
      button.classList.toggle("is-selected", isSelected);
      button.setAttribute("aria-checked", isSelected ? "true" : "false");
    });

    if (shouldPersist) {
      persistColor();
    }
  }

  function getPlayerName() {
    var value = String(refs.nameInput.value || "").trim();
    var name = value ? value.slice(0, 18) : "Jogador";
    refs.nameInput.value = name;
    return name;
  }

  function cleanRoomCode(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/[^A-Z2-9]/g, "")
      .slice(0, 4);
  }

  function send(payload) {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
      updateStatus(false, "Ainda nao conectou ao servidor.");
      return;
    }

    state.socket.send(JSON.stringify(payload));
  }

  function persistName() {
    try {
      window.localStorage.setItem(storageKeys.name, getPlayerName());
    } catch (error) {
      return;
    }
  }

  function persistColor() {
    try {
      window.localStorage.setItem(storageKeys.color, state.selectedColor);
    } catch (error) {
      return;
    }
  }

  function requestImmersiveMode() {
    primeAudio();
    closeHelpModal();

    var root = document.documentElement;

    if (!document.fullscreenElement && root.requestFullscreen) {
      root.requestFullscreen().catch(function () {
        return;
      });
    }

    if (window.screen && screen.orientation && screen.orientation.lock) {
      screen.orientation.lock("landscape").catch(function () {
        return;
      });
    }

    scheduleCanvasResize();
  }

  function updateStatus(isConnected, message) {
    state.connected = isConnected;
    state.statusText = message;
    renderStatus();
  }

  function renderStatus() {
    refs.statusText.textContent = state.statusText;
    refs.connectionBadge.textContent = state.connected ? "Online" : "Offline";
    refs.connectionBadge.className = state.connected ? "badge badge-online" : "badge badge-offline";
    refs.leaveButton.disabled = !state.room;
  }

  function render() {
    renderFocusMode();
    renderPanels();
    renderRoomDirectory();
    renderRanking();
    renderRoom();
    renderMobileControls();
    drawBoard();
  }

  function startCanvasLoop() {
    if (animationFrameId) {
      return;
    }

    function frame() {
      drawBoard();
      animationFrameId = window.requestAnimationFrame(frame);
    }

    animationFrameId = window.requestAnimationFrame(frame);
  }

  function renderFocusMode() {
    var nextFocusMode = shouldFocusGame();

    if (nextFocusMode) {
      closeHelpModal();
    }

    if (state.focusMode !== nextFocusMode) {
      state.focusMode = nextFocusMode;
      document.body.classList.toggle("game-focus", nextFocusMode);
      scheduleCanvasResize();
    }
  }

  function openHelpModal() {
    if (!refs.helpModal) {
      return;
    }

    syncHelpRules();
    refs.helpModal.classList.remove("hidden");
    refs.helpModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("help-open");
  }

  function closeHelpModal() {
    if (!refs.helpModal) {
      document.body.classList.remove("help-open");
      return;
    }

    refs.helpModal.classList.add("hidden");
    refs.helpModal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("help-open");
  }

  function isHelpModalOpen() {
    return !!refs.helpModal && !refs.helpModal.classList.contains("hidden");
  }

  function scheduleCanvasResize() {
    var delays = [0, 40, 120, 260];

    while (resizeTimers.length) {
      window.clearTimeout(resizeTimers.pop());
    }

    delays.forEach(function (delay) {
      resizeTimers.push(
        window.setTimeout(function () {
          resizeCanvas();
        }, delay)
      );
    });
  }

  function shouldFocusGame() {
    var selfPlayer = getSelfPlayer();

    if (!state.room) {
      return false;
    }

    if (state.room.status === "countdown") {
      return true;
    }

    if (state.room.status === "playing") {
      return !!selfPlayer && !!selfPlayer.alive;
    }

    if (state.room.status === "over") {
      return isWinnerRevealPhase(state.room);
    }

    return false;
  }

  function renderPanels() {
    var hasRoom = !!state.room;
    var nextHomeHidden = hasRoom;
    var nextRoomHidden = !hasRoom;
    var visibilityChanged =
      refs.homePanel.classList.contains("hidden") !== nextHomeHidden ||
      refs.roomPanel.classList.contains("hidden") !== nextRoomHidden;

    refs.homePanel.classList.toggle("hidden", nextHomeHidden);
    refs.roomPanel.classList.toggle("hidden", nextRoomHidden);

    if (visibilityChanged) {
      scheduleCanvasResize();
    }
  }

  function renderRoomDirectory() {
    var shouldShowDirectory = !state.focusMode && !state.room;
    var visibilityChanged =
      refs.roomDirectoryCard.classList.contains("hidden") === shouldShowDirectory;
    var rooms = state.roomsOverview.slice();

    refs.roomDirectoryCard.classList.toggle("hidden", !shouldShowDirectory);

    if (!shouldShowDirectory) {
      refs.roomDirectoryCount.textContent = "0";
      refs.roomDirectoryList.innerHTML = "";

      if (visibilityChanged) {
        scheduleCanvasResize();
      }

      return;
    }

    refs.roomDirectoryCount.textContent = String(rooms.length);

    if (!rooms.length) {
      refs.roomDirectoryList.innerHTML = [
        '<li class="room-directory-empty">',
        state.connected
          ? "Nenhuma sala criada ainda. Crie a primeira para comecar."
          : "Conectando para carregar as salas...",
        "</li>"
      ].join("");
    } else {
      refs.roomDirectoryList.innerHTML = rooms
        .map(function (roomSummary) {
          var roomStatus = getRoomDirectoryStatus(roomSummary);

          return [
            '<li class="room-directory-item">',
            '  <div class="room-directory-copy">',
            '    <span class="room-directory-code">',
            escapeHtml(roomSummary.code),
            "</span>",
            '    <span class="room-directory-meta">',
            roomSummary.playerCount,
            "/",
            roomSummary.maxPlayers,
            " jogadores",
            "</span>",
            "  </div>",
            '  <span class="room-directory-badge ',
            roomStatus.className,
            '">',
            roomStatus.label,
            "</span>",
            "</li>"
          ].join("");
        })
        .join("");
    }

    if (visibilityChanged) {
      scheduleCanvasResize();
    }
  }

  function renderRoom() {
    if (!state.room) {
      stopCountdownLoop();
      stopRoundTimerLoop();
      stopResultPhaseTimer();
      refs.gameTitle.textContent = "Esperando sala";
      refs.gameSubtitle.textContent = "Crie ou entre em uma sala para comecar.";
      refs.hudRoomPill.textContent = "Sala ----";
      refs.hudStatusPill.textContent = "Aguardando partida";
      refs.hudTimerPill.classList.add("hidden");
      refs.hudRulePill.classList.add("hidden");
      refs.focusLeaveButton.classList.add("hidden");
      refs.overlayLabel.textContent = "SnakeTV";
      refs.overlayTitle.textContent = "Crie uma sala";
      refs.overlayText.textContent = "O jogo vai aparecer aqui assim que voce entrar em uma partida.";
      refs.overlayCountdown.classList.add("hidden");
      refs.gameOverlay.classList.remove("hidden");
      refs.startGameButton.classList.add("hidden");
      refs.restartGameButton.classList.add("hidden");
      refs.roomHelpButton.classList.add("hidden");
      refs.roomLeaveButton.classList.add("hidden");
      refs.shareLinkText.textContent = "";
      refs.playerList.innerHTML = "";
      refs.playerCountText.textContent = "0/4";
      refs.roomCodeText.textContent = "----";
      refs.scoreStrip.innerHTML = "";
      refs.leaveButton.disabled = true;
      return;
    }

    var room = state.room;
    var isHost = room.hostId === state.you;
    var selfPlayer = getSelfPlayer();
    var isSpectating = room.status === "playing" && selfPlayer && !selfPlayer.alive;
    var winner = getWinner(room);
    var winnerRevealPhase = isWinnerRevealPhase(room);
    var showResultControls = room.status === "over" && !winnerRevealPhase;
    var shareLink = window.location.origin + "/?room=" + room.code;
    var secondsLeft = room.countdownEndsAt ? getCountdownSeconds(room.countdownEndsAt) : 0;

    syncResultPhaseTimer();
    refs.roomCodeText.textContent = room.code;
    refs.shareLinkText.textContent = shareLink;
    refs.playerCountText.textContent = room.players.length + "/" + room.maxPlayers;
    refs.hudRoomPill.textContent = "Sala " + room.code;
    refs.focusLeaveButton.classList.toggle("hidden", !showResultControls);

    refs.startGameButton.classList.toggle("hidden", !isHost || room.status !== "lobby");
    refs.roomLeaveButton.classList.toggle("hidden", isHost);
    refs.roomHelpButton.classList.remove("hidden");
    refs.restartGameButton.classList.toggle("hidden", !isHost || !showResultControls);
    refs.startGameButton.disabled = !isHost || room.players.length === 0;
    refs.restartGameButton.disabled = !isHost || room.players.length === 0 || winnerRevealPhase;
    refs.leaveButton.disabled = winnerRevealPhase;
    refs.roomLeaveButton.disabled = winnerRevealPhase;

    if (room.status === "lobby") {
      stopCountdownLoop();
      stopRoundTimerLoop();
      refs.gameTitle.textContent = "Sala pronta";
      refs.gameSubtitle.textContent = "Compartilhe o codigo ou o link e espere todos entrarem.";
      refs.hudStatusPill.textContent = "Aguardando o host";
      refs.hudTimerPill.classList.add("hidden");
      refs.hudRulePill.classList.add("hidden");
    } else if (room.status === "countdown") {
      stopRoundTimerLoop();
      refs.gameTitle.textContent = "Contagem iniciada";
      refs.gameSubtitle.textContent = "A arena vai travar e todos comecam juntos.";
      refs.hudStatusPill.textContent = "Comeca em " + secondsLeft + "s";
      refs.hudTimerPill.classList.add("hidden");
      refs.hudRulePill.classList.add("hidden");
    } else if (room.status === "playing") {
      stopCountdownLoop();
      startRoundTimerLoop();
      refs.gameTitle.textContent = isSpectating ? "Voce foi eliminado" : "Partida em andamento";
      refs.gameSubtitle.textContent = isSpectating
        ? "O menu voltou so para voce. Continue assistindo a rodada em tempo real."
        : "Use as setinhas para mudar a direcao e OK ou clique para lancar uma bolinha.";
      refs.hudStatusPill.textContent = isSpectating ? "Assistindo a rodada" : "Rodada ao vivo";
      refs.hudTimerPill.classList.remove("hidden");
      refs.hudRulePill.classList.remove("hidden");
      updateRoundTimerDisplay();
    } else {
      stopCountdownLoop();
      stopRoundTimerLoop();
      refs.hudTimerPill.classList.add("hidden");
      refs.hudRulePill.classList.add("hidden");

      if (winnerRevealPhase) {
        refs.gameTitle.textContent = winner ? winner.name + " venceu" : "Rodada encerrada";
        refs.gameSubtitle.textContent = room.endReason === "timeout"
          ? "O tempo acabou. Vence quem pegou mais esferas."
          : "Segure mais um instante. O fim da partida aparece em seguida.";
        refs.hudStatusPill.textContent = room.endReason === "timeout"
          ? "Tempo encerrado"
          : winner ? "Vencedor definido" : "Sem vencedor";
      } else {
        refs.gameTitle.textContent = "Fim do jogo";
        refs.gameSubtitle.textContent = room.endReason === "timeout"
          ? (isHost
              ? "O tempo acabou. Use Jogar de novo para iniciar outra rodada."
              : "O tempo acabou. Aguarde o host iniciar novamente.")
          : (isHost
              ? "Use Jogar de novo para iniciar outra rodada."
              : "Aguarde o host iniciar novamente.");
        refs.hudStatusPill.textContent = room.endReason === "timeout"
          ? (winner ? "Mais esferas: " + winner.name : "Tempo encerrado")
          : winner ? "Vitoria de " + winner.name : "Sem vencedor";
      }
    }

    if (!state.focusMode) {
      renderPlayers(room.players, room.status);
    }

    renderScoreStrip(room.players, room.status);
    renderOverlay(room, winner, isHost);
  }

  function renderMobileControls() {
    var selfPlayer = getSelfPlayer();
    var shouldShow = !!(
      refs.mobileControls &&
      supportsTouchUi &&
      state.room &&
      state.room.status === "playing" &&
      selfPlayer &&
      selfPlayer.alive
    );

    if (!refs.mobileControls) {
      return;
    }

    refs.mobileControls.classList.toggle("hidden", !shouldShow);
    refs.gameStage.classList.toggle("has-mobile-controls", shouldShow);

    if (refs.mobileShootButton) {
      refs.mobileShootButton.disabled =
        !shouldShow || !selfPlayer || getPlayerAvailableShots(selfPlayer) <= 0;
    }
  }

  function renderRanking() {
    var ranking = getCurrentRanking();
    var shouldShow = !state.focusMode && !!state.room;

    refs.rankingCard.classList.toggle("hidden", !shouldShow);

    if (!shouldShow) {
      return;
    }

    refs.rankingResetText.textContent = getRankingResetLabel(ranking);

    if (!ranking || !Array.isArray(ranking.top) || !ranking.top.length) {
      refs.rankingList.innerHTML = '<li class="ranking-empty">Nenhuma vitoria registrada ainda nesta semana.</li>';
      refs.rankingSelfText.classList.add("hidden");
      refs.rankingSelfText.textContent = "";
      return;
    }

    refs.rankingList.innerHTML = ranking.top
      .map(function (entry) {
        return [
          '<li class="ranking-item ',
          getRankingToneClass(entry.position),
          '">',
          '  <span class="ranking-position">#',
          entry.position,
          "</span>",
          '  <span class="ranking-name">',
          escapeHtml(entry.name),
          "</span>",
          '  <span class="ranking-points">',
          entry.points,
          entry.points === 1 ? " pt" : " pts",
          "</span>",
          "</li>"
        ].join("");
      })
      .join("");

    if (ranking.you) {
      refs.rankingSelfText.textContent =
        "Sua posicao: #" +
        ranking.you.position +
        " com " +
        ranking.you.points +
        (ranking.you.points === 1 ? " ponto." : " pontos.");
      refs.rankingSelfText.classList.remove("hidden");
      return;
    }

    refs.rankingSelfText.classList.add("hidden");
    refs.rankingSelfText.textContent = "";
  }

  function renderPlayers(players, roomStatus) {
    var sortedPlayers = players.slice().sort(function (left, right) {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.name.localeCompare(right.name);
    });

    refs.playerList.innerHTML = sortedPlayers
      .map(function (player) {
        return [
          '<li class="',
          buildPlayerStateClasses("player-row", player, roomStatus),
          '">',
          '  <span class="player-color" style="background:',
          player.color,
          '"></span>',
          '  <div class="player-meta">',
          '    <span class="player-name">',
          '      <span class="name-text">',
          escapeHtml(player.name),
          "</span>",
          player.isHost ? '<span class="host-crown" aria-label="Host" title="Host"></span>' : "",
          "</span>",
          '    <span class="player-copy">',
          escapeHtml(getPlayerStateLabel(player, roomStatus)),
          player.id === state.you ? " . Voce" : "",
          "</span>",
          "  </div>",
          '  <span class="player-score">',
          String(player.score).padStart(2, "0"),
          "</span>",
          "</li>"
        ].join("");
      })
      .join("");
  }

  function renderScoreStrip(players, roomStatus) {
    if (roomStatus === "lobby") {
      refs.scoreStrip.innerHTML = "";
      return;
    }

    var sortedPlayers = players.slice().sort(function (left, right) {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.name.localeCompare(right.name);
    });

    refs.scoreStrip.innerHTML = sortedPlayers
      .map(function (player) {
        return [
          '<div class="',
          buildPlayerStateClasses("score-chip", player, roomStatus),
          '">',
          '  <div class="score-chip-head">',
          '    <div class="score-chip-left">',
          '      <span class="score-chip-color" style="background:',
          player.color,
          '"></span>',
          '      <span class="score-chip-name">',
          '        <span class="name-text">',
          escapeHtml(player.name),
          player.id === state.you ? " *" : "",
          "</span>",
          player.isHost ? '<span class="host-crown" aria-label="Host" title="Host"></span>' : "",
          "</span>",
          "    </div>",
          '    <span class="score-chip-score">',
          String(player.score).padStart(2, "0"),
          "</span>",
          "  </div>",
          '  <div class="score-chip-meta">',
          escapeHtml(buildLivesLabel(player) + " . " + getPlayerStateLabel(player, roomStatus)),
          "</div>",
          "</div>"
        ].join("");
      })
      .join("");
  }

  function renderOverlay(room, winner, isHost) {
    if (room.status === "playing") {
      stopCountdownLoop();
      refs.gameOverlay.classList.add("hidden");
      refs.overlayCountdown.classList.add("hidden");
      return;
    }

    refs.gameOverlay.classList.remove("hidden");

    if (room.status === "lobby") {
      stopCountdownLoop();
      refs.overlayLabel.textContent = "Sala " + room.code;
      refs.overlayTitle.textContent = isHost ? "Voce controla o inicio" : "Esperando o host";
      refs.overlayText.textContent = isHost
        ? "Quando todos entrarem, selecione Iniciar rodada."
        : "Deixe esta tela pronta. A rodada comeca quando o host iniciar.";
      refs.overlayCountdown.classList.add("hidden");
      return;
    }

    if (room.status === "countdown") {
      refs.overlayLabel.textContent = "Rodada vai comecar";
      refs.overlayTitle.textContent = "Prepare as setas";
      refs.overlayText.textContent = "Todos iniciam juntos. O nome da cobrinha vai aparecer acima dela.";
      refs.overlayCountdown.classList.remove("hidden");
      startCountdownLoop();
      return;
    }

    stopCountdownLoop();
    if (isWinnerRevealPhase(room)) {
      refs.overlayLabel.textContent = room.endReason === "timeout" ? "Tempo encerrado" : "Vencedor";
      refs.overlayTitle.textContent = winner ? winner.name : "Todos foram eliminados";
      refs.overlayText.textContent = room.endReason === "timeout"
        ? (winner
            ? "O tempo acabou. Quem pegou mais esferas vence. Em 3 segundos aparece o fim do jogo."
            : "O tempo acabou. Em 3 segundos aparece o fim do jogo.")
        : (winner
            ? "A partida terminou. Em 3 segundos aparece o fim do jogo."
            : "Nenhuma cobrinha sobreviveu. Em 3 segundos aparece o fim do jogo.");
      refs.overlayCountdown.classList.add("hidden");
      return;
    }

    refs.overlayLabel.textContent = room.endReason === "timeout" ? "Fim do tempo" : "Fim do jogo";
    refs.overlayTitle.textContent = winner ? winner.name + " venceu" : "Todos foram eliminados";
    refs.overlayText.textContent = room.endReason === "timeout"
      ? (isHost
          ? "Vence quem nao morrer ou pegar mais esferas. Use Jogar de novo para iniciar outra rodada."
          : "Vence quem nao morrer ou pegar mais esferas. Aguarde o host iniciar a proxima rodada.")
      : (isHost
          ? "Use Jogar de novo para iniciar outra contagem."
          : "Aguarde o host iniciar a proxima rodada.");
    refs.overlayCountdown.classList.add("hidden");
  }

  function drawBoard() {
    var room = state.room;
    var gridSize = room ? room.gridSize : 38;
    var cellSize = boardSize / gridSize;
    var renderPlayers = room ? getRenderPlayers(room) : [];

    ctx.clearRect(0, 0, boardSize, boardSize);
    drawBoardBackground(gridSize, cellSize);

    if (!room) {
      return;
    }

    getRoomFoods(room).forEach(function (food) {
      drawFood(food, cellSize);
    });

    renderPlayers.forEach(function (player) {
      drawSnake(player, cellSize);
    });

    if (room.shots && room.shots.length) {
      room.shots.forEach(function (shot) {
        drawShot(shot, cellSize);
      });
    }

    renderPlayers.forEach(function (player) {
      drawPlayerName(player, cellSize);
    });
  }

  function drawBoardBackground(gridSize, cellSize) {
    var gradient = ctx.createLinearGradient(0, 0, boardSize, boardSize);
    gradient.addColorStop(0, "#102733");
    gradient.addColorStop(1, "#07141a");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, boardSize, boardSize);

    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;

    for (var index = 0; index <= gridSize; index += 1) {
      var line = index * cellSize;
      ctx.beginPath();
      ctx.moveTo(line, 0);
      ctx.lineTo(line, boardSize);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, line);
      ctx.lineTo(boardSize, line);
      ctx.stroke();
    }
  }

  function drawFood(food, cellSize) {
    var centerX = food.x * cellSize + cellSize / 2;
    var centerY = food.y * cellSize + cellSize / 2;
    var radius = cellSize * 0.28;
    var boosted = isBoostFoodActive(food);

    ctx.fillStyle = boosted ? "#57b8ff" : "#ff8a3d";
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = boosted ? "rgba(255,255,255,0.34)" : "rgba(255,255,255,0.24)";
    ctx.beginPath();
    ctx.arc(centerX - radius * 0.3, centerY - radius * 0.35, radius * 0.34, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawShot(shot, cellSize) {
    if (!shot || !shot.points || !shot.points.length) {
      return;
    }

    var radius = Math.max(4, cellSize * 0.16);
    var lineWidth = Math.max(3, cellSize * 0.14);

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = applyAlpha(shot.color || "#ffd166", 0.88);
    ctx.lineWidth = lineWidth;
    ctx.beginPath();

    shot.points.forEach(function (point, index) {
      var centerX = point.x * cellSize + cellSize / 2;
      var centerY = point.y * cellSize + cellSize / 2;

      if (index === 0) {
        ctx.moveTo(centerX, centerY);
      } else {
        ctx.lineTo(centerX, centerY);
      }
    });

    ctx.stroke();

    shot.points.forEach(function (point, index) {
      var centerX = point.x * cellSize + cellSize / 2;
      var centerY = point.y * cellSize + cellSize / 2;
      var dotRadius = index === shot.points.length - 1 ? radius * 1.14 : radius;

      ctx.fillStyle = index === shot.points.length - 1
        ? "#fff2d4"
        : applyAlpha(shot.color || "#ffd166", 0.94);
      ctx.beginPath();
      ctx.arc(centerX, centerY, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.restore();
  }

  function drawSnake(player, cellSize) {
    if (!player.segments || !player.segments.length) {
      return;
    }

    var immune = isPlayerImmune(player);

    for (var index = player.segments.length - 1; index >= 0; index -= 1) {
      var segment = player.segments[index];
      var inset = index === 0 ? cellSize * 0.08 : cellSize * 0.12;
      var x = segment.x * cellSize + inset;
      var y = segment.y * cellSize + inset;
      var size = cellSize - inset * 2;

      ctx.fillStyle = index === 0
        ? applyAlpha(player.color, immune ? 0.74 : 1)
        : applyAlpha(shadeHex(player.color, -14), immune ? 0.58 : 1);
      ctx.fillRect(x, y, size, size);

      if (!player.alive) {
        ctx.fillStyle = "rgba(6, 18, 25, 0.48)";
        ctx.fillRect(x, y, size, size);
      }
    }
  }

  function drawPlayerName(player, cellSize) {
    if (!player.segments || !player.segments.length) {
      return;
    }

    var head = player.segments[0];
    var label = player.name;
    var hearts = buildLivesText(player);
    var ammoDots = getPlayerAmmoDots(player);
    var immune = isPlayerImmune(player);
    var ammoRadius = Math.max(2.4, Math.min(4.2, cellSize * 0.13));
    var ammoGap = Math.max(4, ammoRadius * 1.35);
    var ammoHeight = ammoDots.length ? Math.max(6, ammoRadius * 2 + 1) : 0;
    var heartFontSize = Math.max(10, Math.min(16, cellSize * 0.52));
    var fontSize = Math.max(13, Math.min(22, cellSize * 0.72));
    var lineGap = Math.max(2, cellSize * 0.08);
    var paddingX = Math.max(8, cellSize * 0.22);
    var paddingY = Math.max(6, cellSize * 0.14);
    var centerX = head.x * cellSize + cellSize / 2;
    var ammoWidth = ammoDots.length
      ? ammoDots.length * ammoRadius * 2 + (ammoDots.length - 1) * ammoGap
      : 0;
    var chipY = head.y * cellSize - (
      ammoHeight +
      (ammoHeight ? lineGap : 0) +
      heartFontSize +
      fontSize +
      paddingY * 2 +
      lineGap
    ) - cellSize * 0.38;

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.font = "700 " + heartFontSize + "px Trebuchet MS, Segoe UI, sans-serif";
    var heartsWidth = ctx.measureText(hearts).width;
    ctx.font = "700 " + fontSize + "px Trebuchet MS, Segoe UI, sans-serif";
    var textWidth = ctx.measureText(label).width;
    var chipWidth = Math.max(textWidth, heartsWidth, ammoWidth) + paddingX * 2;
    var chipHeight = ammoHeight + heartFontSize + fontSize + paddingY * 2 + lineGap + (ammoHeight ? lineGap : 0);
    var chipX = clamp(centerX - chipWidth / 2, 8, boardSize - chipWidth - 8);
    var ammoY = chipY + paddingY + (ammoHeight ? ammoHeight / 2 : 0);
    var heartsY = chipY + paddingY + (ammoHeight ? ammoHeight + lineGap : 0) + heartFontSize / 2;
    var nameY = heartsY + heartFontSize / 2 + lineGap + fontSize / 2;

    if (chipY < 8) {
      chipY = head.y * cellSize + cellSize + 6;
      ammoY = chipY + paddingY + (ammoHeight ? ammoHeight / 2 : 0);
      heartsY = chipY + paddingY + heartFontSize / 2;
      if (ammoHeight) {
        heartsY = chipY + paddingY + ammoHeight + lineGap + heartFontSize / 2;
      }
      nameY = heartsY + heartFontSize / 2 + lineGap + fontSize / 2;
    }

    chipY = clamp(chipY, 8, boardSize - chipHeight - 8);
    ammoY = chipY + paddingY + (ammoHeight ? ammoHeight / 2 : 0);
    heartsY = chipY + paddingY + heartFontSize / 2;
    if (ammoHeight) {
      heartsY = chipY + paddingY + ammoHeight + lineGap + heartFontSize / 2;
    }
    nameY = heartsY + heartFontSize / 2 + lineGap + fontSize / 2;

    fillRoundedRect(chipX, chipY, chipWidth, chipHeight, chipHeight / 2, "rgba(4, 14, 19, 0.86)");
    ctx.lineWidth = 1;
    ctx.strokeStyle = immune
      ? "rgba(135, 226, 255, 0.78)"
      : applyAlpha(player.color, player.alive ? 0.72 : 0.4);
    strokeRoundedRect(chipX, chipY, chipWidth, chipHeight, chipHeight / 2);

    if (ammoDots.length) {
      drawAmmoDots(chipX + chipWidth / 2, ammoY, ammoDots, ammoRadius, ammoGap);
    }

    ctx.font = "700 " + heartFontSize + "px Trebuchet MS, Segoe UI, sans-serif";
    ctx.fillStyle = "#ff8fab";
    ctx.fillText(hearts, chipX + chipWidth / 2, heartsY);

    ctx.font = "700 " + fontSize + "px Trebuchet MS, Segoe UI, sans-serif";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.42)";
    ctx.strokeText(label, chipX + chipWidth / 2, nameY);
    ctx.fillStyle = player.alive ? "#f6f7eb" : "rgba(246, 247, 235, 0.7)";
    ctx.fillText(label, chipX + chipWidth / 2, nameY);
    ctx.restore();
  }

  function drawAmmoDots(centerX, centerY, ammoDots, radius, gap) {
    var totalWidth = ammoDots.length * radius * 2 + (ammoDots.length - 1) * gap;
    var startX = centerX - totalWidth / 2 + radius;

    ammoDots.forEach(function (dot, index) {
      var x = startX + index * (radius * 2 + gap);
      var alpha = dot.ready ? 0.95 : 0.16 + dot.progress * 0.34;

      ctx.fillStyle = "rgba(87, 184, 255, " + alpha + ")";
      ctx.beginPath();
      ctx.arc(x, centerY, radius, 0, Math.PI * 2);
      ctx.fill();

      if (!dot.ready) {
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(87, 184, 255, " + (0.18 + dot.progress * 0.26) + ")";
        ctx.beginPath();
        ctx.arc(x, centerY, radius + 0.4, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }

  function fillRoundedRect(x, y, width, height, radius, fillStyle) {
    ctx.beginPath();
    roundedRectPath(x, y, width, height, radius);
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }

  function strokeRoundedRect(x, y, width, height, radius) {
    ctx.beginPath();
    roundedRectPath(x, y, width, height, radius);
    ctx.stroke();
  }

  function roundedRectPath(x, y, width, height, radius) {
    var safeRadius = Math.min(radius, width / 2, height / 2);

    ctx.moveTo(x + safeRadius, y);
    ctx.lineTo(x + width - safeRadius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
    ctx.lineTo(x + width, y + height - safeRadius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
    ctx.lineTo(x + safeRadius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
    ctx.lineTo(x, y + safeRadius);
    ctx.quadraticCurveTo(x, y, x + safeRadius, y);
    ctx.closePath();
  }

  function resizeCanvas() {
    if (!canvas || !refs.gameStage) {
      return;
    }

    var stageWidth = refs.gameStage.clientWidth || window.innerWidth;
    var stageHeight = refs.gameStage.clientHeight || window.innerHeight;
    var styles = window.getComputedStyle(refs.gameStage);
    var paddingX = parseFloat(styles.paddingLeft || "0") + parseFloat(styles.paddingRight || "0");
    var paddingY = parseFloat(styles.paddingTop || "0") + parseFloat(styles.paddingBottom || "0");
    var safeHorizontal = state.focusMode ? 12 : 8;
    var safeVertical = state.focusMode ? 16 : 12;

    boardSize = Math.max(
      280,
      Math.min(
        stageWidth - paddingX - safeHorizontal,
        stageHeight - paddingY - safeVertical,
        state.focusMode ? 980 : 860
      )
    );

    var pixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(boardSize * pixelRatio);
    canvas.height = Math.floor(boardSize * pixelRatio);
    canvas.style.width = boardSize + "px";
    canvas.style.height = boardSize + "px";
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    drawBoard();
  }

  function primeAudio() {
    var AudioCtor = window.AudioContext || window.webkitAudioContext;

    if (!AudioCtor) {
      return;
    }

    if (!audioContext) {
      audioContext = new AudioCtor();
    }

    if (audioContext.state === "suspended") {
      audioContext.resume().catch(function () {
        return;
      });
    }
  }

  function playLocalStateSounds(previousRoom, nextRoom, playerId) {
    if (
      !previousRoom ||
      !nextRoom ||
      previousRoom.code !== nextRoom.code ||
      !playerId
    ) {
      return;
    }

    var previousPlayer = findPlayerById(previousRoom, playerId);
    var nextPlayer = findPlayerById(nextRoom, playerId);

    if (!previousPlayer || !nextPlayer) {
      return;
    }

    if ((nextPlayer.score || 0) > (previousPlayer.score || 0)) {
      playPixelCollectSound();
    }

    if ((nextPlayer.lives || 0) < (previousPlayer.lives || 0)) {
      playPixelHitSound();
    }
  }

  function playPixelCollectSound() {
    playPixelSound([
      { duration: 0.04, frequency: 640, gain: 0.022, offset: 0 },
      { duration: 0.05, frequency: 820, gain: 0.018, offset: 0.04 }
    ]);
  }

  function playPixelHitSound() {
    playPixelSound([
      { duration: 0.05, frequency: 360, gain: 0.024, offset: 0 },
      { duration: 0.06, frequency: 240, gain: 0.02, offset: 0.05 }
    ]);
  }

  function playPixelSound(steps) {
    if (!steps || !steps.length) {
      return;
    }

    primeAudio();

    if (!audioContext || audioContext.state !== "running") {
      return;
    }

    var now = audioContext.currentTime;

    steps.forEach(function (step) {
      var oscillator = audioContext.createOscillator();
      var gainNode = audioContext.createGain();
      var startAt = now + (step.offset || 0);
      var attackAt = startAt + 0.008;
      var endAt = startAt + Math.max(0.02, step.duration || 0.04);

      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(step.frequency || 440, startAt);
      gainNode.gain.setValueAtTime(0.0001, startAt);
      gainNode.gain.linearRampToValueAtTime(step.gain || 0.02, attackAt);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, endAt);
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.start(startAt);
      oscillator.stop(endAt + 0.01);
    });
  }

  function copyShareLink() {
    if (!state.room) {
      return;
    }

    var shareLink = window.location.origin + "/?room=" + state.room.code;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(shareLink)
        .then(function () {
          updateStatus(true, "Link copiado.");
        })
        .catch(function () {
          refs.shareLinkText.textContent = shareLink;
        });
      return;
    }

    refs.shareLinkText.textContent = shareLink;
    updateStatus(true, "Copie o link exibido na tela.");
  }

  function syncRoomCodeToUrl() {
    var nextUrl = window.location.pathname;

    if (state.room && state.room.code) {
      nextUrl += "?room=" + state.room.code;
    }

    window.history.replaceState({}, "", nextUrl);
  }

  function getWinner(room) {
    if (!room || !room.winnerId) {
      return null;
    }

    for (var index = 0; index < room.players.length; index += 1) {
      if (room.players[index].id === room.winnerId) {
        return room.players[index];
      }
    }

    return null;
  }

  function getRoomFoods(room) {
    if (!room) {
      return [];
    }

    if (Array.isArray(room.foods) && room.foods.length) {
      return room.foods;
    }

    if (room.food) {
      return [room.food];
    }

    return [];
  }

  function shouldInterpolateRoomState(previousRoom, nextRoom) {
    return !!previousRoom &&
      !!nextRoom &&
      previousRoom.code === nextRoom.code &&
      previousRoom.status === "playing" &&
      nextRoom.status === "playing";
  }

  function getRenderPlayers(room) {
    if (!room || !room.players) {
      return [];
    }

    return room.players.map(function (player) {
      var progress = getRoomInterpolationProgress(room, player);

      if (progress >= 1 || !state.previousRoom) {
        return player;
      }

      return interpolatePlayer(player, progress);
    });
  }

  function getRoomInterpolationProgress(room, player) {
    var tickMs = room && room.tickMs ? room.tickMs : 1;
    var interpolationRatio = player && player.id === state.you ? 0.38 : 0.62;

    if (!state.previousRoom || !room || room.status !== "playing" || !state.roomUpdatedAt) {
      return 1;
    }

    return clamp(
      (Date.now() - state.roomUpdatedAt) / Math.max(1, tickMs * interpolationRatio),
      0,
      1
    );
  }

  function interpolatePlayer(player, progress) {
    var previousPlayer = findPlayerById(state.previousRoom, player.id);

    if (
      !previousPlayer ||
      !previousPlayer.alive ||
      !player.alive ||
      !previousPlayer.segments ||
      !player.segments ||
      !previousPlayer.segments.length ||
      !player.segments.length ||
      Math.abs(previousPlayer.segments.length - player.segments.length) > 1
    ) {
      return player;
    }

    return Object.assign({}, player, {
      segments: player.segments.map(function (segment, index) {
        var previousSegment = previousPlayer.segments[
          Math.min(index, previousPlayer.segments.length - 1)
        ];

        if (!previousSegment) {
          return segment;
        }

        return {
          x: lerp(previousSegment.x, segment.x, progress),
          y: lerp(previousSegment.y, segment.y, progress)
        };
      })
    });
  }

  function findPlayerById(room, playerId) {
    if (!room || !room.players) {
      return null;
    }

    for (var index = 0; index < room.players.length; index += 1) {
      if (room.players[index].id === playerId) {
        return room.players[index];
      }
    }

    return null;
  }

  function getPlayerAmmoDots(player) {
    var shotLimit = getShotLimit();
    var shotWindowMs = getShotWindowMs();
    var recentShots = getPlayerRecentShots(player);
    var readyCount = Math.max(0, shotLimit - recentShots.length);
    var dots = [];
    var index = 0;
    var canShootByLength = !!player && !!player.segments && player.segments.length >= 4;

    for (index = 0; index < readyCount; index += 1) {
      dots.push({
        progress: 1,
        ready: canShootByLength
      });
    }

    recentShots.forEach(function (shotAt) {
      dots.push({
        progress: clamp((Date.now() - shotAt) / shotWindowMs, 0, 1),
        ready: false
      });
    });

    while (dots.length < shotLimit) {
      dots.push({
        progress: 0,
        ready: false
      });
    }

    return dots.slice(0, shotLimit);
  }

  function getPlayerAvailableShots(player) {
    return Math.max(0, getShotLimit() - getPlayerRecentShots(player).length);
  }

  function getPlayerRecentShots(player) {
    var shotWindowMs = getShotWindowMs();
    var recentShots = Array.isArray(player && player.recentShots) ? player.recentShots.slice() : [];

    return recentShots
      .filter(function (shotAt) {
        return Date.now() - shotAt < shotWindowMs;
      })
      .sort(function (left, right) {
        return left - right;
      });
  }

  function getShotLimit() {
    return state.room && state.room.shotLimit ? state.room.shotLimit : 3;
  }

  function getShotWindowMs() {
    return state.room && state.room.shotWindowMs ? state.room.shotWindowMs : 7000;
  }

  function isBoostFoodActive(food) {
    return !!food && !!food.boostUntil && food.boostUntil > Date.now();
  }

  function getRoomDirectoryStatus(roomSummary) {
    if (!roomSummary) {
      return {
        className: "is-open",
        label: "Aberta"
      };
    }

    if (roomSummary.status === "playing") {
      return {
        className: "is-live",
        label: "Em partida"
      };
    }

    if (roomSummary.status === "countdown") {
      return {
        className: "is-countdown",
        label: "Contagem"
      };
    }

    if (roomSummary.isFull) {
      return {
        className: "is-full",
        label: "Cheia"
      };
    }

    return {
      className: "is-open",
      label: "Aberta"
    };
  }

  function getPlayerStateLabel(player, roomStatus) {
    if (roomStatus === "lobby") {
      return player.isHost ? "Host" : "Pronto";
    }

    if (roomStatus === "countdown") {
      return player.isHost ? "Host . Preparado" : "Preparado";
    }

    if (roomStatus === "playing") {
      var states = ["Vivo"];

      if (isPlayerImmune(player)) {
        states.push("Imune " + getImmunitySeconds(player) + "s");
      }

      if (isPlayerBoosted(player)) {
        states.push("Turbo " + getBoostSeconds(player) + "s");
      }

      if (!isPlayerImmune(player) && !isPlayerBoosted(player)) {
        states.push("Jogando");
      }

      return player.alive ? states.join(" . ") : "Morto . Assistindo";
    }

    return player.alive ? "Vivo . Sobreviveu" : "Morto . Eliminado";
  }

  function buildPlayerStateClasses(baseClass, player, roomStatus) {
    var classes = [baseClass];

    if (player.id === state.you) {
      classes.push("is-you");
    }

    if (roomStatus === "countdown") {
      classes.push("is-ready");
    } else if (roomStatus === "playing" || roomStatus === "over") {
      classes.push(player.alive ? "is-alive" : "is-dead");
    }

    if (isPlayerImmune(player)) {
      classes.push("is-immune");
    }

    if (isPlayerBoosted(player)) {
      classes.push("is-boosted");
    }

    return classes.join(" ");
  }

  function buildLivesText(player) {
    var maxLives = Math.max(0, player.maxLives || 2);
    var lives = clamp(player.lives || 0, 0, maxLives);
    var filled = [];
    var empty = [];
    var index = 0;

    for (index = 0; index < lives; index += 1) {
      filled.push("\u2665");
    }

    for (index = lives; index < maxLives; index += 1) {
      empty.push("\u2661");
    }

    return filled.concat(empty).join(" ");
  }

  function buildLivesLabel(player) {
    return buildLivesText(player);
  }

  function isPlayerImmune(player) {
    return !!player && !!player.alive && !!player.immuneUntil && player.immuneUntil > Date.now();
  }

  function isPlayerBoosted(player) {
    return !!player && !!player.alive && !!player.speedBoostUntil && player.speedBoostUntil > Date.now();
  }

  function getImmunitySeconds(player) {
    if (!player || !player.immuneUntil) {
      return 0;
    }

    return Math.max(0, Math.ceil((player.immuneUntil - Date.now()) / 1000));
  }

  function getBoostSeconds(player) {
    if (!player || !player.speedBoostUntil) {
      return 0;
    }

    return Math.max(0, Math.ceil((player.speedBoostUntil - Date.now()) / 1000));
  }

  function getCountdownSeconds(countdownEndsAt) {
    return Math.max(0, Math.ceil((countdownEndsAt - Date.now()) / 1000));
  }

  function getRoundMsLeft(roundEndsAt) {
    return Math.max(0, roundEndsAt - Date.now());
  }

  function formatRoundTime(milliseconds) {
    var totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    var minutes = Math.floor(totalSeconds / 60);
    var seconds = totalSeconds % 60;

    return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
  }

  function getSelfPlayer() {
    if (!state.room) {
      return null;
    }

    for (var index = 0; index < state.room.players.length; index += 1) {
      if (state.room.players[index].id === state.you) {
        return state.room.players[index];
      }
    }

    return null;
  }

  function statusFromRoom(room) {
    if (!room) {
      return "Pronto para criar ou entrar em uma sala.";
    }

    if (room.status === "lobby") {
      return "Sala " + room.code + " pronta. Aguarde o host.";
    }

    if (room.status === "countdown") {
      return "Contagem iniciada. Todos vao comecar juntos.";
    }

    if (room.status === "playing") {
      var selfPlayer = getSelfPlayer();

      if (selfPlayer && !selfPlayer.alive) {
        return "Voce foi eliminado. Agora voce assiste a partida em tempo real.";
      }

      return "Partida ao vivo. Vence quem nao morrer ou pegar mais esferas.";
    }

    var winner = getWinner(room);

    if (isWinnerRevealPhase(room)) {
      if (room.endReason === "timeout") {
        return winner
          ? "Tempo encerrado. " + winner.name + " venceu nas esferas."
          : "Tempo encerrado.";
      }

      return winner ? winner.name + " venceu a partida." : "Rodada encerrada.";
    }

    if (room.endReason === "timeout") {
      return winner ? "Fim do jogo. " + winner.name + " venceu por esferas." : "Fim do jogo.";
    }

    return winner ? "Fim do jogo. " + winner.name + " venceu a rodada." : "Fim do jogo.";
  }

  function isWinnerRevealPhase(room) {
    return !!room &&
      room.status === "over" &&
      !!room.showGameOverAt &&
      room.showGameOverAt > Date.now();
  }

  function getCurrentRanking() {
    if (state.room && state.room.ranking) {
      return state.room.ranking;
    }

    return state.ranking;
  }

  function getRankingResetLabel(ranking) {
    if (!ranking || !ranking.cycleEndsAt) {
      return "7 dias";
    }

    var remainingMs = Math.max(0, ranking.cycleEndsAt - Date.now());
    var remainingDays = Math.ceil(remainingMs / 86400000);

    if (remainingDays <= 1) {
      return "Reseta hoje";
    }

    return "Reseta em " + remainingDays + "d";
  }

  function getRankingToneClass(position) {
    if (position === 1) {
      return "is-gold";
    }

    if (position === 2) {
      return "is-silver";
    }

    if (position === 3) {
      return "is-bronze";
    }

    return "is-plain";
  }

  function shadeHex(color, amount) {
    var normalized = String(color || "").replace("#", "");
    var value = parseInt(normalized, 16);

    if (Number.isNaN(value)) {
      return color;
    }

    var red = clamp(((value >> 16) & 255) + amount, 0, 255);
    var green = clamp(((value >> 8) & 255) + amount, 0, 255);
    var blue = clamp((value & 255) + amount, 0, 255);

    return "#" + toHex(red) + toHex(green) + toHex(blue);
  }

  function applyAlpha(hexColor, alpha) {
    var normalized = String(hexColor || "").replace("#", "");
    var value = parseInt(normalized, 16);

    if (Number.isNaN(value)) {
      return "rgba(255,255,255," + alpha + ")";
    }

    return [
      "rgba(",
      (value >> 16) & 255,
      ",",
      (value >> 8) & 255,
      ",",
      value & 255,
      ",",
      alpha,
      ")"
    ].join("");
  }

  function lerp(start, end, progress) {
    return start + (end - start) * progress;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toHex(value) {
    return value.toString(16).padStart(2, "0");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();
