const firebaseConfig = {
  apiKey: "AIzaSyBrhgsPY3hh9rzGc8IquMqB2Gk5gAbheoo",
  authDomain: "financas-familia-af8d3.firebaseapp.com",
  databaseURL: "https://financas-familia-af8d3-default-rtdb.firebaseio.com",
  projectId: "financas-familia-af8d3",
  storageBucket: "financas-familia-af8d3.firebasestorage.app",
  messagingSenderId: "1036879289314",
  appId: "1:1036879289314:web:7590dc5f7af0d0eb7b77bb"
};

const DEFAULT_CATEGORIES = {
  alimentacao: { label: "Alimentação", icon: "🛒" },
  transporte: { label: "Transporte", icon: "🚌" },
  saude: { label: "Saúde", icon: "💊" },
  lazer: { label: "Lazer", icon: "🎬" },
  casa: { label: "Casa", icon: "🏠" },
  roupas: { label: "Roupas", icon: "👗" },
  outros: { label: "Outros", icon: "📦" }
};

let db = null;
let useLocalMode = false;

let userName = "";
let roomCode = "";

let gastos = {};
let receitas = {};
let contas = {};
let meta = { valor: 0 };
let categorias = { ...DEFAULT_CATEGORIES };

let chartCat = null;
let chartDaily = null;
let presenceInterval = null;
let roomListenersBound = false;
let roomRootRef = null;
let presenceListRef = null;

const editingState = {
  gasto: null,
  receita: null,
  conta: null
};

initializeDataSource();

function initializeDataSource() {
  const hasFirebaseConfig =
    firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.databaseURL &&
    firebaseConfig.projectId &&
    !firebaseConfig.databaseURL.includes("SEU_PROJETO");

  useLocalMode = !hasFirebaseConfig;

  if (hasFirebaseConfig) {
    try {
      firebase.initializeApp(firebaseConfig);
      db = firebase.database();
    } catch (error) {
      console.error("Falha ao iniciar Firebase. Entrando em modo local.", error);
      useLocalMode = true;
    }
  }
}

function getDefaultRoomData() {
  return {
    gastos: {},
    receitas: {},
    contas: {},
    meta: { valor: 0 },
    categorias: { ...DEFAULT_CATEGORIES }
  };
}

function normalizeRoomData(raw = {}) {
  const fallback = getDefaultRoomData();
  return {
    gastos: raw.gastos || fallback.gastos,
    receitas: raw.receitas || fallback.receitas,
    contas: raw.contas || fallback.contas,
    meta: raw.meta || fallback.meta,
    categorias: { ...DEFAULT_CATEGORIES, ...(raw.categorias || {}) }
  };
}

function applyRoomData(raw = {}) {
  const roomData = normalizeRoomData(raw);
  gastos = roomData.gastos;
  receitas = roomData.receitas;
  contas = roomData.contas;
  meta = roomData.meta;
  categorias = roomData.categorias;
  renderAll();
}

function getRoomStorageKey() {
  return `fin_room_data_${roomCode}`;
}

function getPresenceKey() {
  return `fin_presence_${roomCode}`;
}

function loadLocalRoom() {
  try {
    return normalizeRoomData(JSON.parse(localStorage.getItem(getRoomStorageKey()) || "{}"));
  } catch (error) {
    console.error("Falha ao ler dados locais da sala.", error);
    return getDefaultRoomData();
  }
}

function saveLocalRoom(data) {
  localStorage.setItem(getRoomStorageKey(), JSON.stringify(normalizeRoomData(data)));
}

function saveLocalState() {
  saveLocalRoom({ gastos, receitas, contas, meta, categorias });
}

function readPresenceMap() {
  try {
    const raw = JSON.parse(localStorage.getItem(getPresenceKey()) || "{}");
    const now = Date.now();
    return Object.fromEntries(
      Object.entries(raw).filter(([, info]) => info && now - info.ts < 90000)
    );
  } catch (error) {
    console.error("Falha ao ler presença local.", error);
    return {};
  }
}

function writePresenceMap(map) {
  localStorage.setItem(getPresenceKey(), JSON.stringify(map));
}

function updateLocalPresence() {
  const map = readPresenceMap();
  map[userName] = { online: true, ts: Date.now() };
  writePresenceMap(map);
  renderPresence(Object.keys(map).length);
}

function syncLocalRoomData(event) {
  if (!useLocalMode) return;

  if (!event || event.key === getRoomStorageKey()) {
    applyRoomData(loadLocalRoom());
  }

  if (!event || event.key === getPresenceKey()) {
    renderPresence(Object.keys(readPresenceMap()).length);
  }
}

function getRoomRef(path = "") {
  return db.ref(path ? `rooms/${roomCode}/${path}` : `rooms/${roomCode}`);
}

function saveCollection(name, value) {
  if (useLocalMode) {
    if (name === "meta") meta = value;
    if (name === "categorias") categorias = value;
    saveLocalState();
    syncLocalRoomData();
    return Promise.resolve();
  }

  return getRoomRef(name).set(value);
}

function removeItem(collection, id) {
  if (useLocalMode) {
    if (collection === "gastos") delete gastos[id];
    if (collection === "receitas") delete receitas[id];
    if (collection === "contas") delete contas[id];
    saveLocalState();
    syncLocalRoomData();
    return Promise.resolve();
  }

  return getRoomRef(`${collection}/${id}`).remove();
}

function setItem(collection, id, value) {
  if (useLocalMode) {
    if (collection === "gastos") gastos[id] = value;
    if (collection === "receitas") receitas[id] = value;
    if (collection === "contas") contas[id] = value;
    saveLocalState();
    syncLocalRoomData();
    return Promise.resolve();
  }

  return getRoomRef(`${collection}/${id}`).set(value);
}

function updateItem(collection, id, patch) {
  if (useLocalMode) {
    const target =
      collection === "gastos" ? gastos :
      collection === "receitas" ? receitas :
      contas;

    if (!target[id]) return Promise.resolve();
    target[id] = { ...target[id], ...patch };
    saveLocalState();
    syncLocalRoomData();
    return Promise.resolve();
  }

  return getRoomRef(`${collection}/${id}`).update(patch);
}

function enterApp() {
  userName = document.getElementById("user-name").value.trim();
  roomCode = document.getElementById("room-code").value.trim().toLowerCase().replace(/\s+/g, "-");

  if (!userName) return showToast("Digite seu nome.");
  if (!roomCode) return showToast("Digite o código da sala.");

  localStorage.setItem("fin_user", userName);
  localStorage.setItem("fin_room", roomCode);

  startApp();

  if (useLocalMode) {
    showToast("Modo local ativo. Configure o Firebase para sincronizar em tempo real.");
  }
}

function exitApp() {
  if (presenceInterval) clearInterval(presenceInterval);
  window.removeEventListener("storage", syncLocalRoomData);

  if (useLocalMode) {
    const map = readPresenceMap();
    delete map[userName];
    writePresenceMap(map);
  } else if (roomCode && userName) {
    if (roomRootRef) roomRootRef.off();
    if (presenceListRef) presenceListRef.off();
    getRoomRef(`presence/${userName}`).remove();
  }

  document.getElementById("setup-screen").classList.add("active");
  document.getElementById("app-screen").classList.remove("active");

  userName = "";
  roomCode = "";
  roomRootRef = null;
  presenceListRef = null;
  applyRoomData(getDefaultRoomData());
  clearEditingState();
}

function startApp() {
  document.getElementById("setup-screen").classList.remove("active");
  document.getElementById("app-screen").classList.add("active");
  document.getElementById("room-display").textContent = roomCode;

  setDefaultDates();
  bindRoomListeners();
  setupPresence();
  hydrateRoom();
}

function setDefaultDates() {
  const today = new Date().toISOString().split("T")[0];
  ["gasto-data", "receita-data", "conta-venc"].forEach((id) => {
    const el = document.getElementById(id);
    if (el && !el.value) el.value = today;
  });
}

function bindRoomListeners() {
  if (roomListenersBound) return;
  roomListenersBound = true;
  window.addEventListener("storage", syncLocalRoomData);
}

function hydrateRoom() {
  if (useLocalMode) {
    applyRoomData(loadLocalRoom());
    return;
  }

  roomRootRef = getRoomRef();
  roomRootRef.on("value", (snap) => {
    applyRoomData(snap.val() || {});
  });
}

function setupPresence() {
  if (useLocalMode) {
    updateLocalPresence();
    renderPresence(Object.keys(readPresenceMap()).length);
    presenceInterval = setInterval(updateLocalPresence, 30000);
    return;
  }

  const presenceRef = getRoomRef(`presence/${userName}`);
  presenceRef.set({ online: true, ts: Date.now() });
  presenceRef.onDisconnect().remove();

  presenceListRef = getRoomRef("presence");
  presenceListRef.on("value", (snap) => {
    const value = snap.val() || {};
    renderPresence(Object.keys(value).length);
  });
}

function renderPresence(count) {
  document.getElementById("online-count").textContent = `${count || 1} online`;
}

function renderAll() {
  renderCategoryOptions();
  syncMetaInput();
  renderDashboard();
  renderGastos();
  renderReceitas();
  renderContas();
  renderRelatorio();
}

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(ym) {
  const [year, month] = ym.split("-");
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric"
  });
}

function formatDate(dateString) {
  if (!dateString) return "";
  const [year, month, day] = dateString.split("-");
  return `${day}/${month}/${year}`;
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2200);
}

function getMonthEntries(collection, month) {
  return Object.entries(collection).filter(([, item]) => item.data && item.data.startsWith(month));
}

function getCurrentMonthStats(month = getCurrentMonth()) {
  const gastosMes = getMonthEntries(gastos, month).map(([, item]) => item);
  const receitasMes = getMonthEntries(receitas, month).map(([, item]) => item);
  const contasPendentes = Object.values(contas).filter((item) => !item.paga);

  const totalGastos = gastosMes.reduce((sum, item) => sum + Number(item.valor || 0), 0);
  const totalReceitas = receitasMes.reduce((sum, item) => sum + Number(item.valor || 0), 0);
  const totalContasPendentes = contasPendentes.reduce((sum, item) => sum + Number(item.valor || 0), 0);

  return {
    gastosMes,
    receitasMes,
    contasPendentes,
    totalGastos,
    totalReceitas,
    totalContasPendentes,
    saldo: totalReceitas - totalGastos - totalContasPendentes
  };
}

function syncMetaInput() {
  document.getElementById("meta-mensal").value = meta.valor ? Number(meta.valor).toFixed(2) : "";
}

function saveMeta() {
  const value = parseFloat(document.getElementById("meta-mensal").value);
  const nextMeta = { valor: Number.isFinite(value) && value > 0 ? value : 0 };
  meta = nextMeta;
  saveCollection("meta", nextMeta).then(() => {
    renderDashboard();
    showToast("Meta atualizada.");
  });
}

function renderDashboard() {
  const stats = getCurrentMonthStats();

  document.getElementById("saldo-mes").textContent = formatCurrency(stats.saldo);
  document.getElementById("total-gasto").textContent = formatCurrency(stats.totalGastos);
  document.getElementById("total-receitas").textContent = formatCurrency(stats.totalReceitas);
  document.getElementById("contas-pendentes").textContent = String(stats.contasPendentes.length);

  renderMetaCard(stats.saldo);
  renderAlerts();
  renderPeopleSummary();
  renderRecentActivity();
}

function renderMetaCard(saldo) {
  const goal = Number(meta.valor || 0);
  const progress = goal > 0 ? Math.max(0, Math.min(100, (saldo / goal) * 100)) : 0;

  document.getElementById("meta-valor").textContent = formatCurrency(goal);
  document.getElementById("meta-percentual").textContent = `${Math.round(progress)}%`;
  document.getElementById("meta-fill").style.width = `${progress}%`;

  let status = "Defina uma meta para acompanhar sua sobra do mês.";
  if (goal > 0 && saldo >= goal) {
    status = "Meta atingida. Ótimo ritmo neste mês.";
  } else if (goal > 0 && saldo > 0) {
    status = `Faltam ${formatCurrency(goal - saldo)} para bater a meta.`;
  } else if (goal > 0) {
    status = "Ainda não há sobra no mês. Foque em reduzir gastos e contas pendentes.";
  }

  document.getElementById("meta-status").textContent = status;
}

function renderAlerts() {
  const list = document.getElementById("alert-list");
  const today = new Date();
  const isoToday = today.toISOString().split("T")[0];
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const isoTomorrow = tomorrow.toISOString().split("T")[0];

  const alerts = [];
  Object.values(contas).forEach((conta) => {
    if (conta.paga) return;
    if (conta.venc < isoToday) {
      alerts.push({ type: "danger", text: `${conta.nome} está vencida desde ${formatDate(conta.venc)}.` });
    } else if (conta.venc === isoToday) {
      alerts.push({ type: "warning", text: `${conta.nome} vence hoje.` });
    } else if (conta.venc === isoTomorrow) {
      alerts.push({ type: "info", text: `${conta.nome} vence amanhã.` });
    }
  });

  const stats = getCurrentMonthStats();
  if (meta.valor && stats.saldo < meta.valor) {
    alerts.push({ type: "info", text: "A meta mensal ainda não foi atingida." });
  }

  if (!alerts.length) {
    list.innerHTML = '<div class="empty-state">Nenhum alerta por enquanto.</div>';
    return;
  }

  list.innerHTML = alerts
    .slice(0, 5)
    .map((alert) => `<div class="alert-item ${alert.type}">${escapeHtml(alert.text)}</div>`)
    .join("");
}

function renderPeopleSummary() {
  const container = document.getElementById("people-summary");
  const month = getCurrentMonth();
  const summary = {};

  getMonthEntries(gastos, month).forEach(([, item]) => {
    summary[item.autor] = summary[item.autor] || { gastos: 0, receitas: 0 };
    summary[item.autor].gastos += Number(item.valor || 0);
  });

  getMonthEntries(receitas, month).forEach(([, item]) => {
    summary[item.autor] = summary[item.autor] || { gastos: 0, receitas: 0 };
    summary[item.autor].receitas += Number(item.valor || 0);
  });

  const rows = Object.entries(summary);
  if (!rows.length) {
    container.innerHTML = '<div class="empty-state">As movimentações por pessoa vão aparecer aqui.</div>';
    return;
  }

  container.innerHTML = rows
    .map(([person, values]) => `
      <div class="mini-item">
        <div>
          <div class="mini-title">${escapeHtml(person)}</div>
          <div class="mini-sub">Receitas ${formatCurrency(values.receitas)} · Gastos ${formatCurrency(values.gastos)}</div>
        </div>
        <div class="mini-value ${values.receitas - values.gastos >= 0 ? "positive" : "negative"}">
          ${formatCurrency(values.receitas - values.gastos)}
        </div>
      </div>
    `)
    .join("");
}

function getCategoryMeta(key) {
  return categorias[key] || { label: key, icon: "📦" };
}

function renderRecentActivity() {
  const recentList = document.getElementById("recent-list");
  const items = [
    ...Object.entries(gastos).map(([id, item]) => ({ id, kind: "gasto", ...item })),
    ...Object.entries(receitas).map(([id, item]) => ({ id, kind: "receita", ...item })),
    ...Object.entries(contas).map(([id, item]) => ({ id, kind: "conta", data: item.venc, ...item }))
  ]
    .sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0))
    .slice(0, 6);

  if (!items.length) {
    recentList.innerHTML = '<div class="empty-state">Nenhuma movimentação ainda.</div>';
    return;
  }

  recentList.innerHTML = items
    .map((item) => {
      let icon = "📦";
      let title = item.desc || item.nome || "Movimentação";
      let metaText = `${formatDate(item.data)} · ${escapeHtml(item.autor || "-")}`;
      let value = Number(item.valor || 0);
      let valueClass = "negative";

      if (item.kind === "gasto") {
        const cat = getCategoryMeta(item.cat);
        icon = cat.icon;
        metaText = `${formatDate(item.data)} · ${escapeHtml(cat.label)} · ${escapeHtml(item.autor || "-")}`;
      } else if (item.kind === "receita") {
        icon = "💸";
        metaText = `${formatDate(item.data)} · ${escapeHtml(item.fonte || "Receita")} · ${escapeHtml(item.autor || "-")}`;
        valueClass = "positive";
      } else if (item.kind === "conta") {
        icon = item.paga ? "✅" : "📅";
        metaText = `Vence ${formatDate(item.venc)} · ${escapeHtml(item.rec)} · ${escapeHtml(item.autor || "-")}`;
        valueClass = item.paga ? "positive" : "negative";
      }

      return `
        <div class="tx-item">
          <div class="tx-left">
            <div class="tx-icon">${icon}</div>
            <div>
              <div class="tx-desc">${escapeHtml(title)}</div>
              <div class="tx-meta">${metaText}</div>
            </div>
          </div>
          <div class="tx-right">
            <div class="tx-value ${valueClass}">${formatCurrency(value)}</div>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderCategoryOptions() {
  const categoryOptions = Object.entries(categorias)
    .sort((a, b) => a[1].label.localeCompare(b[1].label))
    .map(([key, value]) => `<option value="${escapeHtml(key)}">${escapeHtml(value.icon)} ${escapeHtml(value.label)}</option>`)
    .join("");

  document.getElementById("gasto-cat").innerHTML = categoryOptions;
  document.getElementById("filter-cat").innerHTML = `<option value="">Todas as categorias</option>${categoryOptions}`;

  const tagList = document.getElementById("category-list");
  tagList.innerHTML = Object.entries(categorias)
    .map(([key, value]) => `
      <button class="tag-item" onclick="removeCategoria('${escapeHtml(key)}')" ${Object.keys(DEFAULT_CATEGORIES).includes(key) ? "disabled" : ""}>
        <span>${escapeHtml(value.icon)} ${escapeHtml(value.label)}</span>
        ${Object.keys(DEFAULT_CATEGORIES).includes(key) ? "<small>padrão</small>" : "<small>remover</small>"}
      </button>
    `)
    .join("");
}

function addCategoria() {
  const name = document.getElementById("new-cat-name").value.trim();
  const icon = document.getElementById("new-cat-icon").value.trim() || "🏷️";

  if (!name) return showToast("Digite o nome da categoria.");

  const key = slugify(name);
  if (!key) return showToast("Escolha um nome válido para a categoria.");

  categorias[key] = { label: name, icon };
  saveCollection("categorias", categorias).then(() => {
    document.getElementById("new-cat-name").value = "";
    document.getElementById("new-cat-icon").value = "";
    renderCategoryOptions();
    renderGastos();
    renderRelatorio();
    showToast("Categoria adicionada.");
  });
}

function removeCategoria(key) {
  if (DEFAULT_CATEGORIES[key]) return;
  if (Object.values(gastos).some((item) => item.cat === key)) {
    showToast("Essa categoria já está sendo usada em gastos.");
    return;
  }

  delete categorias[key];
  saveCollection("categorias", categorias).then(() => {
    renderCategoryOptions();
    showToast("Categoria removida.");
  });
}

function saveGasto() {
  const previousId = editingState.gasto;
  const desc = document.getElementById("gasto-desc").value.trim();
  const valor = parseFloat(document.getElementById("gasto-valor").value);
  const cat = document.getElementById("gasto-cat").value;
  const data = document.getElementById("gasto-data").value;

  if (!desc) return showToast("Digite a descrição do gasto.");
  if (!Number.isFinite(valor) || valor <= 0) return showToast("Digite um valor válido.");
  if (!data) return showToast("Selecione a data do gasto.");

  const id = previousId || String(Date.now());
  const payload = { desc, valor, cat, data, autor: userName, ts: Date.now() };

  setItem("gastos", id, payload).then(() => {
    clearGastoForm();
    cancelEdit("gasto");
    showToast(previousId ? "Gasto atualizado." : "Gasto adicionado.");
  });
}

function editGasto(id) {
  const item = gastos[id];
  if (!item) return;
  editingState.gasto = id;
  document.getElementById("gasto-form-title").textContent = "Editar Gasto";
  document.getElementById("gasto-cancel-btn").classList.remove("hidden");
  document.getElementById("gasto-desc").value = item.desc;
  document.getElementById("gasto-valor").value = Number(item.valor).toFixed(2);
  document.getElementById("gasto-cat").value = item.cat;
  document.getElementById("gasto-data").value = item.data;
  showTab("gastos");
}

function deleteGasto(id) {
  removeItem("gastos", id).then(() => showToast("Gasto removido."));
}

function clearGastoForm() {
  document.getElementById("gasto-desc").value = "";
  document.getElementById("gasto-valor").value = "";
  document.getElementById("gasto-cat").selectedIndex = 0;
  document.getElementById("gasto-data").value = new Date().toISOString().split("T")[0];
}

function renderGastos() {
  const month = getCurrentMonth();
  const text = document.getElementById("filter-gasto-text").value.trim().toLowerCase();
  const categoryFilter = document.getElementById("filter-cat").value;
  const list = document.getElementById("gastos-list");

  const items = getMonthEntries(gastos, month)
    .filter(([, item]) => !categoryFilter || item.cat === categoryFilter)
    .filter(([, item]) => {
      if (!text) return true;
      return [item.desc, item.autor, getCategoryMeta(item.cat).label].join(" ").toLowerCase().includes(text);
    })
    .sort((a, b) => Number(b[1].ts || 0) - Number(a[1].ts || 0));

  const total = items.reduce((sum, [, item]) => sum + Number(item.valor || 0), 0);
  document.getElementById("gastos-mes-label").textContent = `- ${formatMonthLabel(month)} · ${formatCurrency(total)}`;

  if (!items.length) {
    list.innerHTML = '<div class="empty-state">Nenhum gasto encontrado.</div>';
    return;
  }

  list.innerHTML = items
    .map(([id, item]) => {
      const cat = getCategoryMeta(item.cat);
      return `
        <div class="tx-item">
          <div class="tx-left">
            <div class="tx-icon">${cat.icon}</div>
            <div>
              <div class="tx-desc">${escapeHtml(item.desc)}</div>
              <div class="tx-meta">${formatDate(item.data)} · ${escapeHtml(cat.label)} · ${escapeHtml(item.autor)}</div>
            </div>
          </div>
          <div class="tx-right">
            <div class="tx-value negative">${formatCurrency(item.valor)}</div>
            <button class="ghost-icon-btn" onclick="editGasto('${id}')" title="Editar">Editar</button>
            <button class="tx-delete" onclick="deleteGasto('${id}')" title="Remover">×</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function saveReceita() {
  const previousId = editingState.receita;
  const desc = document.getElementById("receita-desc").value.trim();
  const valor = parseFloat(document.getElementById("receita-valor").value);
  const fonte = document.getElementById("receita-fonte").value.trim();
  const data = document.getElementById("receita-data").value;

  if (!desc) return showToast("Digite a descrição da receita.");
  if (!Number.isFinite(valor) || valor <= 0) return showToast("Digite um valor válido.");
  if (!data) return showToast("Selecione a data da receita.");

  const id = previousId || String(Date.now());
  const payload = { desc, valor, fonte, data, autor: userName, ts: Date.now() };

  setItem("receitas", id, payload).then(() => {
    clearReceitaForm();
    cancelEdit("receita");
    showToast(previousId ? "Receita atualizada." : "Receita adicionada.");
  });
}

function editReceita(id) {
  const item = receitas[id];
  if (!item) return;
  editingState.receita = id;
  document.getElementById("receita-form-title").textContent = "Editar Receita";
  document.getElementById("receita-cancel-btn").classList.remove("hidden");
  document.getElementById("receita-desc").value = item.desc;
  document.getElementById("receita-valor").value = Number(item.valor).toFixed(2);
  document.getElementById("receita-fonte").value = item.fonte || "";
  document.getElementById("receita-data").value = item.data;
  showTab("receitas");
}

function deleteReceita(id) {
  removeItem("receitas", id).then(() => showToast("Receita removida."));
}

function clearReceitaForm() {
  document.getElementById("receita-desc").value = "";
  document.getElementById("receita-valor").value = "";
  document.getElementById("receita-fonte").value = "";
  document.getElementById("receita-data").value = new Date().toISOString().split("T")[0];
}

function renderReceitas() {
  const month = getCurrentMonth();
  const text = document.getElementById("filter-receita-text").value.trim().toLowerCase();
  const list = document.getElementById("receitas-list");

  const items = getMonthEntries(receitas, month)
    .filter(([, item]) => {
      if (!text) return true;
      return [item.desc, item.fonte, item.autor].join(" ").toLowerCase().includes(text);
    })
    .sort((a, b) => Number(b[1].ts || 0) - Number(a[1].ts || 0));

  const total = items.reduce((sum, [, item]) => sum + Number(item.valor || 0), 0);
  document.getElementById("receitas-mes-label").textContent = `- ${formatMonthLabel(month)} · ${formatCurrency(total)}`;

  if (!items.length) {
    list.innerHTML = '<div class="empty-state">Nenhuma receita encontrada.</div>';
    return;
  }

  list.innerHTML = items
    .map(([id, item]) => `
      <div class="tx-item">
        <div class="tx-left">
          <div class="tx-icon">💸</div>
          <div>
            <div class="tx-desc">${escapeHtml(item.desc)}</div>
            <div class="tx-meta">${formatDate(item.data)} · ${escapeHtml(item.fonte || "Receita")} · ${escapeHtml(item.autor)}</div>
          </div>
        </div>
        <div class="tx-right">
          <div class="tx-value positive">${formatCurrency(item.valor)}</div>
          <button class="ghost-icon-btn" onclick="editReceita('${id}')" title="Editar">Editar</button>
          <button class="tx-delete" onclick="deleteReceita('${id}')" title="Remover">×</button>
        </div>
      </div>
    `)
    .join("");
}

function saveConta() {
  const previousId = editingState.conta;
  const nome = document.getElementById("conta-nome").value.trim();
  const valor = parseFloat(document.getElementById("conta-valor").value);
  const venc = document.getElementById("conta-venc").value;
  const rec = document.getElementById("conta-rec").value;

  if (!nome) return showToast("Digite o nome da conta.");
  if (!Number.isFinite(valor) || valor <= 0) return showToast("Digite um valor válido.");
  if (!venc) return showToast("Selecione a data de vencimento.");

  const id = previousId || String(Date.now());
  const prev = contas[id] || {};
  const payload = { nome, valor, venc, rec, paga: Boolean(prev.paga), autor: userName, ts: Date.now() };

  setItem("contas", id, payload).then(() => {
    clearContaForm();
    cancelEdit("conta");
    showToast(previousId ? "Conta atualizada." : "Conta adicionada.");
  });
}

function editConta(id) {
  const item = contas[id];
  if (!item) return;
  editingState.conta = id;
  document.getElementById("conta-form-title").textContent = "Editar Conta";
  document.getElementById("conta-cancel-btn").classList.remove("hidden");
  document.getElementById("conta-nome").value = item.nome;
  document.getElementById("conta-valor").value = Number(item.valor).toFixed(2);
  document.getElementById("conta-venc").value = item.venc;
  document.getElementById("conta-rec").value = item.rec;
  showTab("contas");
}

function marcarPaga(id, pagaAtual) {
  updateItem("contas", id, { paga: !pagaAtual, ts: Date.now() }).then(() => {
    showToast(!pagaAtual ? "Conta marcada como paga." : "Conta voltou para pendente.");
  });
}

function deleteConta(id) {
  removeItem("contas", id).then(() => showToast("Conta removida."));
}

function clearContaForm() {
  document.getElementById("conta-nome").value = "";
  document.getElementById("conta-valor").value = "";
  document.getElementById("conta-venc").value = new Date().toISOString().split("T")[0];
  document.getElementById("conta-rec").value = "mensal";
}

function renderContas() {
  const text = document.getElementById("filter-conta-text").value.trim().toLowerCase();
  const list = document.getElementById("contas-list");
  const today = new Date().toISOString().split("T")[0];

  const items = Object.entries(contas)
    .filter(([, item]) => {
      if (!text) return true;
      return [item.nome, item.autor, item.rec].join(" ").toLowerCase().includes(text);
    })
    .sort((a, b) => a[1].venc.localeCompare(b[1].venc));

  if (!items.length) {
    list.innerHTML = '<div class="empty-state">Nenhuma conta cadastrada.</div>';
    return;
  }

  list.innerHTML = items
    .map(([id, item]) => {
      const overdue = !item.paga && item.venc < today;
      const todayDue = !item.paga && item.venc === today;
      const badge = item.paga
        ? '<span class="conta-badge badge-paga">Paga</span>'
        : overdue
          ? '<span class="conta-badge badge-vencida">Vencida</span>'
          : todayDue
            ? '<span class="conta-badge badge-hoje">Vence hoje</span>'
            : '<span class="conta-badge badge-pendente">Pendente</span>';

      return `
        <div class="conta-item ${overdue ? "vencida" : todayDue ? "hoje" : ""}">
          <div>
            <div class="conta-nome">${escapeHtml(item.nome)}</div>
            <div class="conta-info">Vence ${formatDate(item.venc)} · ${escapeHtml(item.rec)} · ${escapeHtml(item.autor)}</div>
          </div>
          <div class="conta-right">
            ${badge}
            <div class="conta-valor">${formatCurrency(item.valor)}</div>
            <button class="ghost-icon-btn" onclick="editConta('${id}')" title="Editar">Editar</button>
            <button class="pagar-btn" onclick="marcarPaga('${id}', ${item.paga ? "true" : "false"})">${item.paga ? "Reabrir" : "Pagar"}</button>
            <button class="tx-delete" onclick="deleteConta('${id}')" title="Remover">×</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function populateMonthSelector() {
  const select = document.getElementById("rel-mes");
  const current = select.value || getCurrentMonth();
  const months = [];
  const base = new Date();

  for (let i = 0; i < 12; i += 1) {
    const date = new Date(base.getFullYear(), base.getMonth() - i, 1);
    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    months.push(`<option value="${value}">${formatMonthLabel(value)}</option>`);
  }

  select.innerHTML = months.join("");
  select.value = current;
}

function renderRelatorio() {
  populateMonthSelector();
  const month = document.getElementById("rel-mes").value || getCurrentMonth();
  const gastosMes = getMonthEntries(gastos, month).map(([, item]) => item);
  const receitasMes = getMonthEntries(receitas, month).map(([, item]) => item);

  const totalGastos = gastosMes.reduce((sum, item) => sum + Number(item.valor || 0), 0);
  const totalReceitas = receitasMes.reduce((sum, item) => sum + Number(item.valor || 0), 0);

  document.getElementById("rel-total").textContent = formatCurrency(totalGastos);
  document.getElementById("rel-receitas").textContent = formatCurrency(totalReceitas);

  if (!gastosMes.length) {
    document.getElementById("rel-maior").textContent = "-";
    drawCatChart([]);
    drawDailyChart([]);
    return;
  }

  const maior = gastosMes.reduce((current, item) => (item.valor > current.valor ? item : current));
  document.getElementById("rel-maior").textContent = `${escapeHtml(maior.desc)} · ${formatCurrency(maior.valor)}`;

  const byCategory = {};
  gastosMes.forEach((item) => {
    const key = getCategoryMeta(item.cat).label;
    byCategory[key] = (byCategory[key] || 0) + Number(item.valor || 0);
  });

  const byDay = {};
  gastosMes.forEach((item) => {
    byDay[item.data] = (byDay[item.data] || 0) + Number(item.valor || 0);
  });

  drawCatChart(Object.entries(byCategory));
  drawDailyChart(Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0])));
}

function drawCatChart(entries) {
  const canvas = document.getElementById("chart-cat");
  if (!canvas) return;
  if (chartCat) chartCat.destroy();

  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const textColor = isDark ? "#d2c8bd" : "#6e635b";

  chartCat = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: entries.map(([label]) => label),
      datasets: [{
        data: entries.map(([, value]) => value),
        backgroundColor: ["#2d6a4f", "#d97706", "#1d4ed8", "#c1121f", "#7c3aed", "#0f766e", "#b45309"],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: textColor,
            font: { family: "DM Sans", size: 12 },
            boxWidth: 12
          }
        }
      }
    }
  });
}

function drawDailyChart(entries) {
  const canvas = document.getElementById("chart-daily");
  if (!canvas) return;
  if (chartDaily) chartDaily.destroy();

  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const textColor = isDark ? "#d2c8bd" : "#6e635b";
  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";

  chartDaily = new Chart(canvas, {
    type: "bar",
    data: {
      labels: entries.map(([date]) => formatDate(date)),
      datasets: [{
        label: "Gasto diário",
        data: entries.map(([, value]) => value),
        backgroundColor: "#2d6a4f",
        borderRadius: 8,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: { color: textColor, font: { family: "DM Sans", size: 12 } },
          grid: { color: gridColor }
        },
        y: {
          ticks: {
            color: textColor,
            font: { family: "DM Sans", size: 12 },
            callback: (value) => `R$${value}`
          },
          grid: { color: gridColor }
        }
      }
    }
  });
}

function cancelEdit(type) {
  editingState[type] = null;

  if (type === "gasto") {
    document.getElementById("gasto-form-title").textContent = "Novo Gasto";
    document.getElementById("gasto-cancel-btn").classList.add("hidden");
    clearGastoForm();
  }

  if (type === "receita") {
    document.getElementById("receita-form-title").textContent = "Nova Receita";
    document.getElementById("receita-cancel-btn").classList.add("hidden");
    clearReceitaForm();
  }

  if (type === "conta") {
    document.getElementById("conta-form-title").textContent = "Nova Conta";
    document.getElementById("conta-cancel-btn").classList.add("hidden");
    clearContaForm();
  }
}

function clearEditingState() {
  cancelEdit("gasto");
  cancelEdit("receita");
  cancelEdit("conta");
}

function showTab(name, event) {
  document.querySelectorAll(".tab-content").forEach((tab) => tab.classList.remove("active"));
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));

  document.getElementById(`tab-${name}`).classList.add("active");

  const button = event?.currentTarget || document.querySelector(`.tab[data-tab="${name}"]`);
  if (button) button.classList.add("active");

  if (name === "relatorios") renderRelatorio();
}

function exportResumoCsv() {
  const month = document.getElementById("rel-mes")?.value || getCurrentMonth();
  const lines = [["tipo", "descricao", "valor", "data", "categoria_ou_fonte", "autor", "status"]];

  getMonthEntries(receitas, month).forEach(([, item]) => {
    lines.push(["receita", item.desc, Number(item.valor || 0).toFixed(2), item.data, item.fonte || "", item.autor || "", "recebida"]);
  });

  getMonthEntries(gastos, month).forEach(([, item]) => {
    lines.push(["gasto", item.desc, Number(item.valor || 0).toFixed(2), item.data, getCategoryMeta(item.cat).label, item.autor || "", "lançado"]);
  });

  Object.values(contas)
    .filter((item) => item.venc && item.venc.startsWith(month))
    .forEach((item) => {
      lines.push(["conta", item.nome, Number(item.valor || 0).toFixed(2), item.venc, item.rec, item.autor || "", item.paga ? "paga" : "pendente"]);
    });

  const csv = lines
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `financas-${roomCode || "sala"}-${month}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("Exportação concluída.");
}

window.addEventListener("load", () => {
  const savedUser = localStorage.getItem("fin_user");
  const savedRoom = localStorage.getItem("fin_room");

  if (savedUser) document.getElementById("user-name").value = savedUser;
  if (savedRoom) document.getElementById("room-code").value = savedRoom;

  renderCategoryOptions();
  setDefaultDates();
  populateMonthSelector();
  renderAll();
});

window.enterApp = enterApp;
window.exitApp = exitApp;
window.showTab = showTab;
window.saveMeta = saveMeta;
window.addCategoria = addCategoria;
window.removeCategoria = removeCategoria;
window.saveGasto = saveGasto;
window.editGasto = editGasto;
window.deleteGasto = deleteGasto;
window.saveReceita = saveReceita;
window.editReceita = editReceita;
window.deleteReceita = deleteReceita;
window.saveConta = saveConta;
window.editConta = editConta;
window.marcarPaga = marcarPaga;
window.deleteConta = deleteConta;
window.cancelEdit = cancelEdit;
window.exportResumoCsv = exportResumoCsv;
