// === PIECE UNICODE MAP ===
const PIECES = {
  wp: '♙', wn: '♘', wb: '♗', wr: '♖', wq: '♕', wk: '♔',
  bp: '♟', bn: '♞', bb: '♝', br: '♜', bq: '♛', bk: '♚'
};

// === STATE ===
let socket, gameId, myColor = null, selectedSquare = null, legalMoves = [];
let boardFlipped = false, gameOver = false;
let boardState = []; // 8x8 array of {type, color} or null
let lastMove = null, kingInCheck = null;
let moveHistory = [];

// === INIT ===
document.addEventListener('DOMContentLoaded', () => {
  gameId = window.location.pathname.split('/').pop();
  socket = io();
  socket.emit('join-game', gameId);
  setupSocketListeners();
  setupUI();
});

// === SOCKET LISTENERS ===
function setupSocketListeners() {
  socket.on('game-joined', (data) => {
    myColor = data.color;
    boardFlipped = myColor === 'black';
    moveHistory = data.history || [];
    parseFEN(data.fen);
    renderBoard();
    renderMoves();
    updatePlayerCards(data.whiteConnected, data.blackConnected);
    updateTurnIndicator(data.turn);
    document.getElementById('gameStatus').textContent =
      myColor === 'spectator' ? '👁 Spectating' :
      `You are ${myColor === 'white' ? '⬜ White' : '⬛ Black'}`;
  });

  socket.on('player-joined', (data) => {
    updatePlayerCards(data.whiteConnected, data.blackConnected);
    addSystemChat('Opponent connected!');
  });

  socket.on('move-made', (data) => {
    lastMove = { from: data.move.from, to: data.move.to };
    moveHistory = data.history;
    parseFEN(data.fen);
    if (data.isCheck) {
      const kingPos = findKing(data.turn === 'w' ? 'w' : 'b');
      kingInCheck = kingPos;
    } else {
      kingInCheck = null;
    }
    selectedSquare = null;
    legalMoves = [];
    renderBoard();
    renderMoves();
    updateTurnIndicator(data.turn);
    renderCapturedPieces();
    playMoveSound(data.move.captured, data.isCheck);

    if (data.isCheckmate) {
      const winner = data.turn === 'w' ? 'Black' : 'White';
      showModal('👑', 'Checkmate!', `${winner} wins!`, [
        { text: '🔄 Rematch', cls: 'btn-primary', action: () => { socket.emit('request-rematch', gameId); hideModal(); addSystemChat('Rematch requested...'); } },
        { text: '🏠 Home', cls: 'btn-secondary', action: () => window.location.href = '/' }
      ]);
      gameOver = true;
    } else if (data.isDraw || data.isStalemate) {
      showModal('🤝', 'Draw!', data.isStalemate ? 'Stalemate' : 'Game drawn', [
        { text: '🔄 Rematch', cls: 'btn-primary', action: () => { socket.emit('request-rematch', gameId); hideModal(); } },
        { text: '🏠 Home', cls: 'btn-secondary', action: () => window.location.href = '/' }
      ]);
      gameOver = true;
    }
  });

  socket.on('invalid-move', (msg) => addSystemChat('⚠️ ' + msg));

  socket.on('player-disconnected', (data) => {
    updatePlayerCards(data.whiteConnected, data.blackConnected);
    addSystemChat('Opponent disconnected');
  });

  socket.on('draw-offered', (data) => {
    showModal('🤝', 'Draw Offered', `${data.from} offers a draw`, [
      { text: 'Accept', cls: 'btn-primary', action: () => { socket.emit('accept-draw', gameId); hideModal(); } },
      { text: 'Decline', cls: 'btn-secondary', action: hideModal }
    ]);
  });

  socket.on('game-draw', () => {
    showModal('🤝', 'Draw!', 'Game drawn by agreement', [
      { text: '🔄 Rematch', cls: 'btn-primary', action: () => { socket.emit('request-rematch', gameId); hideModal(); } },
      { text: '🏠 Home', cls: 'btn-secondary', action: () => window.location.href = '/' }
    ]);
    gameOver = true;
  });

  socket.on('player-resigned', (data) => {
    showModal('🏳️', 'Resignation', `${data.loser} resigned. ${data.winner} wins!`, [
      { text: '🔄 Rematch', cls: 'btn-primary', action: () => { socket.emit('request-rematch', gameId); hideModal(); } },
      { text: '🏠 Home', cls: 'btn-secondary', action: () => window.location.href = '/' }
    ]);
    gameOver = true;
  });

  socket.on('chat-message', (data) => addChatMessage(data.sender, data.message));

  socket.on('rematch-requested', (data) => {
    showModal('🔄', 'Rematch?', `${data.from} wants a rematch!`, [
      { text: 'Accept', cls: 'btn-primary', action: () => { socket.emit('accept-rematch', gameId); hideModal(); } },
      { text: 'Decline', cls: 'btn-secondary', action: hideModal }
    ]);
  });

  socket.on('rematch-started', (data) => {
    gameOver = false;
    lastMove = null;
    kingInCheck = null;
    selectedSquare = null;
    legalMoves = [];
    moveHistory = [];
    // Swap my color
    if (myColor === 'white') myColor = 'black';
    else if (myColor === 'black') myColor = 'white';
    boardFlipped = myColor === 'black';
    parseFEN(data.fen);
    renderBoard();
    renderMoves();
    updateTurnIndicator(data.turn);
    document.getElementById('gameStatus').textContent =
      `You are ${myColor === 'white' ? '⬜ White' : '⬛ Black'}`;
    document.getElementById('playerCaptured').innerHTML = '';
    document.getElementById('opponentCaptured').innerHTML = '';
    addSystemChat('Rematch started! Colors swapped.');
  });

  socket.on('error-message', (msg) => {
    showModal('❌', 'Error', msg, [
      { text: '🏠 Go Home', cls: 'btn-primary', action: () => window.location.href = '/' }
    ]);
  });
}

// === FEN PARSER ===
function parseFEN(fen) {
  boardState = [];
  const rows = fen.split(' ')[0].split('/');
  for (let r = 0; r < 8; r++) {
    boardState[r] = [];
    let c = 0;
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < parseInt(ch); i++) { boardState[r][c++] = null; }
      } else {
        const color = ch === ch.toUpperCase() ? 'w' : 'b';
        boardState[r][c++] = { type: ch.toLowerCase(), color };
      }
    }
  }
}

// === FIND KING ===
function findKing(color) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = boardState[r][c];
      if (p && p.type === 'k' && p.color === color) {
        const file = String.fromCharCode(97 + c);
        const rank = 8 - r;
        return file + rank;
      }
    }
  }
  return null;
}

// === RENDER BOARD ===
function renderBoard() {
  const board = document.getElementById('chessBoard');
  board.innerHTML = '';
  const files = ['a','b','c','d','e','f','g','h'];
  const ranks = [8,7,6,5,4,3,2,1];

  const displayRanks = boardFlipped ? [...ranks].reverse() : ranks;
  const displayFiles = boardFlipped ? [...files].reverse() : files;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const file = displayFiles[c];
      const rank = displayRanks[r];
      const sq = file + rank;
      const isLight = (r + c) % 2 === 0;
      const actualRow = 8 - rank;
      const actualCol = files.indexOf(file);
      const piece = boardState[actualRow][actualCol];

      const div = document.createElement('div');
      div.className = `square ${isLight ? 'light' : 'dark'}`;
      div.dataset.square = sq;

      // Highlights
      if (lastMove && (sq === lastMove.from || sq === lastMove.to)) div.classList.add('last-move');
      if (selectedSquare === sq) div.classList.add('selected');
      if (kingInCheck && sq === kingInCheck) div.classList.add('check');
      if (legalMoves.includes(sq)) {
        if (piece) div.classList.add('legal-capture');
        else div.classList.add('legal-move');
      }

      if (piece) {
        const span = document.createElement('span');
        span.className = `chess-piece ${piece.color === 'w' ? 'white-piece' : 'black-piece'}`;
        span.textContent = PIECES[piece.color + piece.type];
        div.appendChild(span);
      }

      div.addEventListener('click', () => onSquareClick(sq, piece));
      // Touch support
      div.addEventListener('touchstart', (e) => {
        e.preventDefault();
        onSquareClick(sq, piece);
      }, { passive: false });

      board.appendChild(div);
    }
  }

  // Labels
  renderLabels(displayFiles, displayRanks);
}

function renderLabels(files, ranks) {
  ['topLabels','bottomLabels'].forEach(id => {
    const el = document.getElementById(id);
    el.innerHTML = files.map(f => `<span>${f}</span>`).join('');
  });
  ['leftLabels','rightLabels'].forEach(id => {
    const el = document.getElementById(id);
    el.innerHTML = ranks.map(r => `<span>${r}</span>`).join('');
  });
}

// === SQUARE CLICK HANDLER ===
function onSquareClick(sq, piece) {
  if (gameOver || myColor === 'spectator') return;

  if (selectedSquare) {
    if (sq === selectedSquare) {
      // Deselect
      selectedSquare = null;
      legalMoves = [];
      renderBoard();
      return;
    }
    if (legalMoves.includes(sq)) {
      // Check promotion
      const selPiece = getPieceAt(selectedSquare);
      if (selPiece && selPiece.type === 'p' &&
          ((selPiece.color === 'w' && sq[1] === '8') ||
           (selPiece.color === 'b' && sq[1] === '1'))) {
        showPromotion(selectedSquare, sq);
        return;
      }
      makeMove(selectedSquare, sq);
      return;
    }
    // Clicking another own piece
    if (piece && piece.color === (myColor === 'white' ? 'w' : 'b')) {
      selectSquare(sq);
      return;
    }
    selectedSquare = null;
    legalMoves = [];
    renderBoard();
    return;
  }

  if (piece && piece.color === (myColor === 'white' ? 'w' : 'b')) {
    selectSquare(sq);
  }
}

function selectSquare(sq) {
  selectedSquare = sq;
  legalMoves = calculateLegalMoves(sq);
  renderBoard();
}

function getPieceAt(sq) {
  const col = sq.charCodeAt(0) - 97;
  const row = 8 - parseInt(sq[1]);
  return boardState[row] ? boardState[row][col] : null;
}

// === LEGAL MOVES (client-side estimation) ===
// We rely on server validation, but show hints
function calculateLegalMoves(sq) {
  // We'll use a simple approach: send all possible target squares
  // and let the server validate. For UX, we generate pseudo-legal moves.
  const piece = getPieceAt(sq);
  if (!piece) return [];
  const col = sq.charCodeAt(0) - 97;
  const row = 8 - parseInt(sq[1]);
  const moves = [];
  const addIf = (r, c) => {
    if (r < 0 || r > 7 || c < 0 || c > 7) return false;
    const target = boardState[r][c];
    const tsq = String.fromCharCode(97+c) + (8-r);
    if (!target) { moves.push(tsq); return true; }
    if (target.color !== piece.color) { moves.push(tsq); return false; }
    return false;
  };
  const addCapture = (r, c) => {
    if (r < 0 || r > 7 || c < 0 || c > 7) return;
    const target = boardState[r][c];
    const tsq = String.fromCharCode(97+c) + (8-r);
    if (target && target.color !== piece.color) moves.push(tsq);
  };

  switch (piece.type) {
    case 'p': {
      const dir = piece.color === 'w' ? -1 : 1;
      const startRow = piece.color === 'w' ? 6 : 1;
      // Forward
      if (row+dir >= 0 && row+dir <= 7 && !boardState[row+dir][col]) {
        moves.push(String.fromCharCode(97+col) + (8-(row+dir)));
        if (row === startRow && !boardState[row+2*dir][col]) {
          moves.push(String.fromCharCode(97+col) + (8-(row+2*dir)));
        }
      }
      // Captures
      [col-1, col+1].forEach(cc => {
        if (cc >= 0 && cc <= 7 && row+dir >= 0 && row+dir <= 7) {
          const t = boardState[row+dir][cc];
          const tsq = String.fromCharCode(97+cc) + (8-(row+dir));
          if (t && t.color !== piece.color) moves.push(tsq);
          // En passant approximation: allow diagonal even if empty on ranks 3/6
          if (!t && ((piece.color === 'w' && row+dir === 2) || (piece.color === 'b' && row+dir === 5))) {
            moves.push(tsq);
          }
        }
      });
      break;
    }
    case 'n':
      [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]].forEach(([dr,dc]) => addIf(row+dr,col+dc));
      break;
    case 'b':
      for (const [dr,dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
        for (let i=1;i<8;i++) { if (!addIf(row+dr*i,col+dc*i)) break; if (boardState[row+dr*i] && boardState[row+dr*i][col+dc*i]) break; }
      }
      break;
    case 'r':
      for (const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        for (let i=1;i<8;i++) { if (!addIf(row+dr*i,col+dc*i)) break; if (boardState[row+dr*i] && boardState[row+dr*i][col+dc*i]) break; }
      }
      break;
    case 'q':
      for (const [dr,dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
        for (let i=1;i<8;i++) { if (!addIf(row+dr*i,col+dc*i)) break; if (boardState[row+dr*i] && boardState[row+dr*i][col+dc*i]) break; }
      }
      break;
    case 'k':
      [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]].forEach(([dr,dc]) => addIf(row+dr,col+dc));
      // Castling hints
      if (piece.color === 'w' && row === 7 && col === 4) {
        if (!boardState[7][5] && !boardState[7][6] && boardState[7][7]?.type === 'r') moves.push('g1');
        if (!boardState[7][3] && !boardState[7][2] && !boardState[7][1] && boardState[7][0]?.type === 'r') moves.push('c1');
      }
      if (piece.color === 'b' && row === 0 && col === 4) {
        if (!boardState[0][5] && !boardState[0][6] && boardState[0][7]?.type === 'r') moves.push('g8');
        if (!boardState[0][3] && !boardState[0][2] && !boardState[0][1] && boardState[0][0]?.type === 'r') moves.push('c8');
      }
      break;
  }
  return moves;
}

function makeMove(from, to, promotion) {
  socket.emit('make-move', { gameId, from, to, promotion });
  selectedSquare = null;
  legalMoves = [];
}

// === PROMOTION ===
function showPromotion(from, to) {
  const overlay = document.getElementById('promotionOverlay');
  const container = document.getElementById('promotionPieces');
  const color = myColor === 'white' ? 'w' : 'b';
  const pieces = [
    { type: 'q', symbol: PIECES[color+'q'] },
    { type: 'r', symbol: PIECES[color+'r'] },
    { type: 'b', symbol: PIECES[color+'b'] },
    { type: 'n', symbol: PIECES[color+'n'] }
  ];
  container.innerHTML = '';
  pieces.forEach(p => {
    const btn = document.createElement('button');
    btn.textContent = p.symbol;
    btn.onclick = () => {
      makeMove(from, to, p.type);
      overlay.classList.add('hidden');
    };
    container.appendChild(btn);
  });
  overlay.classList.remove('hidden');
}

// === RENDER MOVES ===
function renderMoves() {
  const list = document.getElementById('movesList');
  list.innerHTML = '';
  for (let i = 0; i < moveHistory.length; i += 2) {
    const row = document.createElement('div');
    row.className = 'move-row';
    const num = document.createElement('span');
    num.className = 'move-number';
    num.textContent = Math.floor(i/2+1) + '.';
    const w = document.createElement('span');
    w.className = 'move-white';
    w.textContent = moveHistory[i].san;
    row.appendChild(num);
    row.appendChild(w);
    if (moveHistory[i+1]) {
      const b = document.createElement('span');
      b.className = 'move-black';
      b.textContent = moveHistory[i+1].san;
      row.appendChild(b);
    }
    list.appendChild(row);
  }
  list.scrollTop = list.scrollHeight;
}

// === CAPTURED PIECES ===
function renderCapturedPieces() {
  const whiteCaptured = [], blackCaptured = [];
  moveHistory.forEach(m => {
    if (m.captured) {
      if (m.color === 'w') blackCaptured.push(PIECES['b' + m.captured]);
      else whiteCaptured.push(PIECES['w' + m.captured]);
    }
  });
  const myCaptures = myColor === 'white' ? blackCaptured : whiteCaptured;
  const oppCaptures = myColor === 'white' ? whiteCaptured : blackCaptured;
  document.getElementById('playerCaptured').textContent = myCaptures.join(' ');
  document.getElementById('opponentCaptured').textContent = oppCaptures.join(' ');
}

// === UI UPDATES ===
function updatePlayerCards(wConn, bConn) {
  if (myColor === 'white') {
    document.getElementById('selfAvatar').textContent = '♔';
    document.getElementById('selfColor').textContent = 'White';
    document.getElementById('opponentAvatar').textContent = '♚';
    document.getElementById('opponentName').textContent = bConn ? 'Opponent' : 'Waiting for opponent...';
    document.getElementById('opponentColor').textContent = 'Black';
    document.getElementById('opponentDot').className = `connection-dot ${bConn ? 'connected' : 'disconnected'}`;
  } else if (myColor === 'black') {
    document.getElementById('selfAvatar').textContent = '♚';
    document.getElementById('selfColor').textContent = 'Black';
    document.getElementById('opponentAvatar').textContent = '♔';
    document.getElementById('opponentName').textContent = wConn ? 'Opponent' : 'Waiting for opponent...';
    document.getElementById('opponentColor').textContent = 'White';
    document.getElementById('opponentDot').className = `connection-dot ${wConn ? 'connected' : 'disconnected'}`;
  }
}

function updateTurnIndicator(turn) {
  const el = document.getElementById('gameStatus');
  if (gameOver) return;
  const isMyTurn = (turn === 'w' && myColor === 'white') || (turn === 'b' && myColor === 'black');
  if (myColor === 'spectator') {
    el.textContent = `👁 ${turn === 'w' ? 'White' : 'Black'}'s turn`;
  } else {
    el.textContent = isMyTurn ? '🟢 Your turn' : '🔴 Opponent\'s turn';
    el.style.borderColor = isMyTurn ? 'var(--accent)' : 'var(--border)';
  }
}

// === CHAT ===
function addChatMessage(sender, message) {
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = `<span class="sender">${sender}:</span> ${escapeHtml(message)}`;
  document.getElementById('chatMessages').appendChild(div);
  document.getElementById('chatMessages').scrollTop = document.getElementById('chatMessages').scrollHeight;
}

function addSystemChat(msg) {
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.style.color = 'var(--accent)';
  div.style.fontStyle = 'italic';
  div.textContent = msg;
  document.getElementById('chatMessages').appendChild(div);
  document.getElementById('chatMessages').scrollTop = document.getElementById('chatMessages').scrollHeight;
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// === SOUND ===
function playMoveSound(captured, isCheck) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = captured ? 300 : isCheck ? 800 : 500;
    gain.gain.value = 0.1;
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  } catch (e) {}
}

// === MODAL ===
function showModal(icon, title, message, buttons) {
  document.getElementById('modalIcon').textContent = icon;
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalMessage').textContent = message;
  const actions = document.getElementById('modalActions');
  actions.innerHTML = '';
  buttons.forEach(b => {
    const btn = document.createElement('button');
    btn.className = `btn ${b.cls}`;
    btn.textContent = b.text;
    btn.onclick = b.action;
    actions.appendChild(btn);
  });
  document.getElementById('modalOverlay').classList.remove('hidden');
}

function hideModal() {
  document.getElementById('modalOverlay').classList.add('hidden');
}

// === SETUP UI EVENTS ===
function setupUI() {
  document.getElementById('sendChatBtn').addEventListener('click', sendChat);
  document.getElementById('chatInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChat();
  });
  document.getElementById('resignBtn').addEventListener('click', () => {
    if (gameOver || myColor === 'spectator') return;
    showModal('🏳️', 'Resign?', 'Are you sure?', [
      { text: 'Yes, Resign', cls: 'btn-danger', action: () => { socket.emit('resign', gameId); hideModal(); } },
      { text: 'Cancel', cls: 'btn-secondary', action: hideModal }
    ]);
  });
  document.getElementById('drawBtn').addEventListener('click', () => {
    if (gameOver || myColor === 'spectator') return;
    socket.emit('offer-draw', gameId);
    addSystemChat('Draw offer sent.');
  });
  document.getElementById('copyGameLink').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      document.getElementById('copyGameLink').textContent = '✅ Copied!';
      setTimeout(() => document.getElementById('copyGameLink').textContent = '🔗 Copy Link', 2000);
    } catch { }
  });
}

function sendChat() {
  const input = document.getElementById('chatInput');
  const msg = input.value.trim();
  if (!msg) return;
  const sender = myColor === 'spectator' ? 'Spectator' : myColor === 'white' ? 'White' : 'Black';
  socket.emit('send-message', { gameId, message: msg, sender });
  input.value = '';
}
