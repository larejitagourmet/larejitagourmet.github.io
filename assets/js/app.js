/* La Rejita Gourmet — carta, opciones y pedido por WhatsApp */
(() => {
  "use strict";

  const CLAVE_PEDIDO = "rejita-pedido-v2";
  const CLAVE_CLIENTE = "rejita-cliente-v1";
  const CLAVE_EVENTO = "rejita-evento-v1";
  const CLAVE_PROMO_VISTA = "rejita-promo-vista";
  const ESPERA_HOJA_MS = 4000;
  const DIAS_EVENTO = 10;
  // Reglas del pedido (se pueden ajustar en productos.json → config.pedido y config.promo2x1)
  let REGLAS = { minutosMinimos: 40, deliveryEstimado: "45–60 min", ultimaHoraRecojo: "22:45", ultimaHoraReserva: "22:00", adelantoReserva: 0.7 };
  let PROMO = { categoria: "Tragos", desde: "19:00", hasta: "22:00" };
  // Abrir la web con ?probar2x1 en la dirección activa la promo a cualquier hora (solo para probarla)
  const PROBAR_2X1 = (() => { try { return new URLSearchParams(location.search).has("probar2x1"); } catch { return false; } })();

  const $ = (sel, raiz = document) => raiz.querySelector(sel);
  const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));

  const ICONO = {
    mas: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    menos: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>',
    flecha: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6"/></svg>',
    tacho: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l.8 11.2A2 2 0 0 0 9.3 20h5.4a2 2 0 0 0 2-1.8L17.5 7M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7"/></svg>',
    cerrar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  };

  let WHATSAPP = "51999225519";
  let datos = null;
  let categorias = [];
  let productos = [];
  const porId = new Map();
  const adicionalPorId = new Map();
  let cremas = { maximoPorCrema: 2, opciones: [] };
  let masPedidos = [];
  let lineas = leer(CLAVE_PEDIDO, []);
  let lineasEvento = leer(CLAVE_EVENTO, []); // “Elegiste:” del formulario de eventos (flujo aparte del pedido)
  let enviado = null; // URL del último pedido enviado a WhatsApp

  /* Cremas: se guardan como { "Ají": 2, "Mayonesa": 1 } (versiones antiguas usaban una lista). */
  function cremasLista(c) {
    if (Array.isArray(c)) return c.map((n) => [n, 1]);
    return Object.entries(c || {}).filter(([, n]) => n > 0);
  }
  function textoCremas(c) {
    return cremasLista(c).map(([n, k]) => (k > 1 ? `${k} ${n}` : n)).join(", ");
  }

  /* ---------- utilidades ---------- */
  function leer(clave, porDefecto) {
    try { return JSON.parse(localStorage.getItem(clave)) || porDefecto; } catch { return porDefecto; }
  }
  function guardar(clave, valor) {
    try { localStorage.setItem(clave, JSON.stringify(valor)); } catch { /* sin almacenamiento */ }
  }
  function esc(texto) {
    return String(texto ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  function normal(texto) {
    return String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }
  function slug(texto) {
    return normal(texto).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }
  function soles(valor) {
    // Con separador de miles: S/ 2,955.00 (los pedidos de fiesta pasan de mil soles)
    return "S/ " + Number(valor).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  function leerPrecio(precio) {
    if (typeof precio === "number" && precio > 0) return { tipo: "fijo", valor: precio };
    const texto = normal(precio ?? "");
    const desde = texto.match(/desde\s*(?:s\/)?\s*([\d.,]+)/);
    if (desde) return { tipo: "desde", valor: Number(desde[1].replace(",", ".")) };
    const numero = Number(texto.replace(",", "."));
    if (texto && numero > 0) return { tipo: "fijo", valor: numero };
    return { tipo: "cotizar" };
  }
  function textoBase(b) {
    if (b.tipo === "cotizar") return "a cotizar";
    return (b.tipo === "desde" ? "desde " : "") + soles(b.valor);
  }
  function anunciar(texto) {
    const nodo = $("[data-anuncio]");
    nodo.textContent = "";
    requestAnimationFrame(() => { nodo.textContent = texto; });
  }
  function plural(n, uno, varios) { return `${n} ${n === 1 ? uno : varios}`; }

  /* ---------- horario (hora de Lima) ---------- */
  function ahoraLima() {
    const partes = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Lima", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23",
    }).formatToParts(new Date());
    const dato = (tipo) => partes.find((x) => x.type === tipo).value;
    const dias = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return { dia: dias[dato("weekday")], hora: Number(dato("hour")) % 24 };
  }
  /* Fechas como "AAAA-MM-DD" y horas como minutos desde la medianoche, siempre en hora de Lima. */
  const APERTURA = 18 * 60;
  const CIERRE = 23 * 60;
  function limaAhora() {
    const partes = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "numeric", hourCycle: "h23",
    }).formatToParts(new Date());
    const dato = (tipo) => partes.find((x) => x.type === tipo).value;
    const iso = `${dato("year")}-${dato("month")}-${dato("day")}`;
    return { iso, dia: diaSemana(iso), min: (Number(dato("hour")) % 24) * 60 + Number(dato("minute")) };
  }
  function diaSemana(iso) { return new Date(iso + "T00:00:00Z").getUTCDay(); }
  function sumarDias(iso, n) { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function abreElDia(iso) { return diaSemana(iso) !== 1; } // los lunes descansamos
  function minutosDe(hhmm) { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + (m || 0); }
  function textoHora(min) {
    const h = Math.floor(min / 60) % 24;
    const m = min % 60;
    return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""} ${h < 12 ? "am" : "pm"}`;
  }
  function textoDia(iso, { corto = false } = {}) {
    const hoy = limaAhora().iso;
    if (iso === hoy) return "Hoy";
    if (iso === sumarDias(hoy, 1)) return "Mañana";
    const f = new Date(iso + "T12:00:00Z");
    const t = new Intl.DateTimeFormat("es-PE", corto ? { timeZone: "UTC", weekday: "short", day: "numeric" } : { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(f).replace(".", "");
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  function estadoLocal() {
    const { dia, hora } = ahoraLima();
    const diaAbierto = dia !== 1;
    if (diaAbierto && hora >= 18 && hora < 23) return { abierto: true, texto: "Abierto ahora · hasta las 11 pm" };
    if (diaAbierto && hora < 18) return { abierto: false, texto: "Hoy abrimos a las 6 pm" };
    if (dia === 0) return { abierto: false, texto: "Cerrado · abrimos el martes 6 pm" };
    return { abierto: false, texto: dia === 1 ? "Hoy descansamos · abrimos mañana 6 pm" : "Cerrado · abrimos mañana 6 pm" };
  }
  /* Pastilla flotante "Abierto ahora": solo con el local abierto y cuando la barra de horario ya no se ve */
  let barraHorarioVisible = true;
  let localAbierto = false;
  function actualizarPastilla() {
    $("[data-pastilla-estado]")?.classList.toggle("visible", localAbierto && !barraHorarioVisible);
  }
  function pintarEstado() {
    const estado = estadoLocal();
    localAbierto = estado.abierto;
    actualizarPastilla();
    $(".barra").dataset.abierto = String(estado.abierto);
    $("[data-estado]").textContent = estado.texto;
    $("[data-estado-largo]").textContent = estado.texto;
    const aviso = $("[data-aviso-cerrado]");
    aviso.hidden = estado.abierto;
    aviso.textContent = estado.abierto ? "" : estado.texto + ". Puedes enviarnos tu pedido igual y te respondemos apenas abramos.";
  }

  /* ---------- modelo de productos ---------- */
  /* Bebidas: "Helada / Sin helar" en las frías y "Con / Sin azúcar" en las preparadas.
     Se marcan en productos.json con "bebida": { "fria": true, "azucar": true } y no cambian el precio. */
  function opcionesBebida(b) {
    if (!b) return [];
    const op = [];
    if (b.fria) op.push({ id: "temperatura", nombre: "Temperatura", secundaria: true, valores: [{ id: "helada", nombre: "Helada" }, { id: "sin-helar", nombre: "Sin helar" }] });
    if (b.azucar) op.push({ id: "azucar", nombre: "Azúcar", secundaria: true, valores: [{ id: "con", nombre: "Con azúcar" }, { id: "sin", nombre: "Sin azúcar" }] });
    return op;
  }
  /* Frozen: un adicional con precio propio (fila "frozen-adicional" de la hoja). Si se elige,
     no se pregunta helada / sin helar. Se activa con "bebida": { "frozen": true }. */
  function adicionalFrozen(p) {
    return p.adicionales.map((id) => adicionalPorId.get(id)).find((a) => a && a.frozen) || null;
  }
  function categoriaDe(p) { return categorias.find((c) => c.nombre === p.categoria) || {}; }
  /* Tipo "evento": solo en el catálogo de eventos. Lo demás se puede pedir. */
  function pedible(p) { return Boolean(p) && p.tipo !== "evento"; }
  /* En la carta: lo pedible, menos las categorías destacadas aparte (Temporada) */
  function enCarta(p) { return pedible(p) && !categoriaDe(p).destacada; }
  function normalizar(json) {
    WHATSAPP = json.config?.whatsapp || WHATSAPP;
    REGLAS = { ...REGLAS, ...(json.config?.pedido || {}) };
    PROMO = { ...PROMO, ...(json.config?.promo2x1 || {}) };
    cremas = json.cremas || cremas;
    (json.adicionales || []).forEach((a) => adicionalPorId.set(a.id, { ...a, precio: leerPrecio(a.precio) }));
    categorias = json.categorias.map((c) => ({ ...c, id: "c-" + slug(c.nombre) }));
    productos = json.productos.map((p) => {
      const cat = categorias.find((c) => c.nombre === p.categoria) || {};
      const precios = (p.precios || [{ id: p.id, precio: p.precio }]).map((e) => ({ ...e, cuando: e.cuando || {}, precio: leerPrecio(e.precio), disponible: e.disponible ?? p.disponible ?? true }));
      return {
        ...p,
        descripcion: p.descripcion || "",
        opciones: [...(p.opciones || []), ...opcionesBebida(p.bebida)],
        adicionales: [...(p.adicionales || []), ...(p.bebida?.frozen ? [...adicionalPorId.values()].filter((a) => a.frozen).map((a) => a.id) : [])].filter((id) => adicionalPorId.has(id)),
        tipo: p.tipo || cat.tipo || "siempre",
        anticipacion: p.anticipacion ?? cat.anticipacion ?? 0,
        anticipacionMax: p.anticipacionMax ?? cat.anticipacionMax ?? 0, // boxes: el modelo elaborado puede tomar más días
        precios,
      };
    });
    productos.forEach((p) => porId.set(p.id, p));
    masPedidos = (json.masPedidos || []).filter((m) => porId.has(m.producto));
  }

  function opcionMezcla(p) {
    return p.opciones.find((o) => o.mezcla);
  }
  function valorElegido(eleccion, opId) {
    const v = eleccion[opId];
    return Array.isArray(v) ? v[0] : v;
  }
  function esMezcla(p, eleccion) {
    const op = opcionMezcla(p);
    return Boolean(op && Array.isArray(eleccion[op.id]) && eleccion[op.id].length > 1);
  }
  function valorValido(valor, eleccion) {
    if (!valor.soloCon) return true;
    return Object.entries(valor.soloCon).every(([opId, permitidos]) => permitidos.includes(valorElegido(eleccion, opId)));
  }
  function entradaPara(p, eleccion) {
    const mezcla = esMezcla(p, eleccion);
    let mejor = null;
    let puntaje = -1;
    p.precios.forEach((e) => {
      const claves = Object.entries(e.cuando);
      const calza = claves.every(([k, v]) => (k === "mezcla" ? v === mezcla : valorElegido(eleccion, k) === v));
      if (calza && claves.length > puntaje) { mejor = e; puntaje = claves.length; }
    });
    return mejor || p.precios[0];
  }
  function precioBase(p, eleccion) {
    const e = entradaPara(p, eleccion);
    if (e.precio.tipo === "cotizar") return { tipo: "cotizar" };
    let valor = e.precio.valor;
    if (e.factor) {
      const op = p.opciones.find((o) => o.id === e.factor);
      const v = op?.valores.find((x) => x.id === valorElegido(eleccion, e.factor));
      valor *= v?.factor || 1;
    }
    return { tipo: e.precio.tipo, valor: Math.round(valor * 100) / 100 };
  }
  function disponible(p, eleccion) {
    // La casilla “disponible” cuenta en todo: carta y eventos (en eventos, lo no disponible no se muestra)
    const op = opcionMezcla(p);
    if (op && esMezcla(p, eleccion)) return eleccion[op.id].every((v) => entradaPara(p, { ...eleccion, [op.id]: v }).disponible);
    return entradaPara(p, eleccion).disponible;
  }
  function agotado(p) {
    return p.precios.every((e) => !e.disponible);
  }
  function eleccionInicial(p, preset = {}) {
    const eleccion = {};
    p.opciones.forEach((op) => {
      const valido = op.valores.filter((v) => valorValido(v, eleccion));
      const elegido = valido.find((v) => v.id === preset[op.id])
        || valido.find((v) => disponible(p, { ...eleccion, [op.id]: v.id }))
        || valido[0];
      eleccion[op.id] = elegido?.id;
    });
    return eleccion;
  }
  /* Rango de precios de un producto, o de una línea de la carta (restr = valores permitidos de la
     opción separada; restr.mezcla = solo el precio de mezcla). */
  function rangoPrecios(p, restr = null) {
    const valores = [];
    let cotiza = false;
    const mezcla = opcionMezcla(p);
    const recorrer = (i, eleccion) => {
      if (i === p.opciones.length) {
        if (p.tipo === "evento" && !disponible(p, eleccion)) return; // en eventos, lo no disponible no cuenta
        if (!(restr && restr.mezcla)) {
          const b = precioBase(p, eleccion);
          if (b.tipo === "cotizar") cotiza = true; else valores.push(b);
        }
        if (mezcla && (!restr || restr.mezcla)) {
          const conMezcla = precioBase(p, { ...eleccion, [mezcla.id]: ["a", "b"] });
          if (conMezcla.tipo !== "cotizar") valores.push(conMezcla);
        }
        return;
      }
      const op = p.opciones[i];
      op.valores
        .filter((v) => valorValido(v, eleccion) && (!restr || op.id !== restr.opId || restr.valores.includes(v.id)))
        .forEach((v) => recorrer(i + 1, { ...eleccion, [op.id]: v.id }));
    };
    recorrer(0, {});
    if (!valores.length) return { texto: "a cotizar", cotiza: true, min: 0 };
    const min = Math.min(...valores.map((v) => v.valor));
    const max = Math.max(...valores.map((v) => v.valor));
    const desde = valores.some((v) => v.tipo === "desde") || min !== max || cotiza; // con cantidades “a cotizar”, el precio es “desde”
    return { texto: (desde ? "desde " : "") + soles(min), cotiza, min };
  }
  function nombreValor(p, opId, valorId) {
    return p.opciones.find((o) => o.id === opId)?.valores.find((v) => v.id === valorId)?.nombre || valorId;
  }
  function unidadesDe(p, op, eleccion) {
    return p.opciones.find((o) => o.id === op.mezcla.cantidadDe)?.valores.find((x) => x.id === valorElegido(eleccion, op.mezcla.cantidadDe))?.unidades;
  }
  function detalleEleccion(p, eleccion) {
    // Las opciones sin valor (p. ej. helada / sin helar en un frozen) no se nombran
    return p.opciones.filter((op) => eleccion[op.id] !== undefined && eleccion[op.id] !== null).map((op) => {
      const v = eleccion[op.id];
      if (Array.isArray(v) && v.length > 1) {
        const total = unidadesDe(p, op, eleccion);
        return v.map((id) => (total ? `${total / 2} ${nombreValor(p, op.id, id)}` : nombreValor(p, op.id, id))).join(" + ");
      }
      return nombreValor(p, op.id, valorElegido(eleccion, op.id));
    }).join(" · ");
  }
  /* Foto propia de lo elegido, nunca la de otro sabor. Si el producto tiene fotos por sabor (o por tipo),
     solo vale la del valor elegido: un sabor sin foto (o una mezcla de dos sabores) no tiene foto y
     se muestra a Misifu con "Pronto su foto". Sin fotos por sabor, vale la foto del producto. */
  function fotoDe(p, eleccion = {}) {
    const conFotos = p.opciones.filter((o) => o.valores.some((v) => v.foto));
    if (!conFotos.length) return p.foto ? { src: p.foto } : null;
    for (const op of conFotos) {
      const elegido = eleccion[op.id];
      if (Array.isArray(elegido) && elegido.length > 1) return null; // mezcla: no hay una foto propia
      const v = op.valores.find((x) => x.id === valorElegido(eleccion, op.id));
      if (v?.foto) return { src: v.foto };
    }
    return null;
  }
  /* ---------- líneas de la carta ----------
     Los sabores o tipos (opción con "separar": true en productos.json) se muestran como líneas propias.
     Cada línea abre el panel con ese sabor elegido; tamaños y cantidades siguen como opciones.
     Los precios y la disponibilidad siguen siendo los del producto, así la hoja de Google no cambia. */
  function opcionSeparada(p) {
    return p.opciones.find((o) => o.separar);
  }
  const cacheLineas = new Map();
  function lineasDe(p) {
    if (cacheLineas.has(p)) return cacheLineas.get(p);
    const op = opcionSeparada(p);
    let lista;
    if (!op) {
      lista = [{ p, clave: p.id, nombre: p.nombre, restr: null, preset: {} }];
    } else {
      const grupos = new Map();
      op.valores.forEach((v) => {
        const nombre = v.linea || `${p.nombre} ${v.nombre}`;
        if (!grupos.has(nombre)) grupos.set(nombre, []);
        grupos.get(nombre).push(v.id);
      });
      lista = [...grupos].map(([nombre, valores]) => ({
        p, nombre, clave: `${p.id}|${valores.join("+")}`,
        restr: { opId: op.id, valores, mezcla: false },
        preset: { [op.id]: valores[0] },
      }));
    }
    cacheLineas.set(p, lista);
    return lista;
  }
  /* La línea que corresponde a una elección (p. ej. un “más pedido” con sabor ya elegido) */
  function lineaPara(p, preset = {}) {
    const ls = lineasDe(p);
    const op = opcionSeparada(p);
    if (!op) return ls[0];
    // Una mezcla (p. ej. BBQ + acevichadas) pertenece a la línea de su primer sabor
    const v = preset[op.id];
    const id = Array.isArray(v) ? v[0] : v;
    return ls.find((l) => !l.restr.mezcla && l.restr.valores.includes(id)) || ls[0];
  }
  function lineaPorClave(p, clave) {
    return lineasDe(p).find((l) => l.clave === clave) || null;
  }
  function presetDe(linea, preset) {
    return { ...linea.preset, ...(preset || {}) };
  }
  /* Opciones que el cliente todavía tiene que elegir en el panel de esa línea */
  function opcionesVisibles(linea) {
    const r = linea.restr;
    const eleccion = eleccionInicial(linea.p, linea.preset);
    return linea.p.opciones.filter((o) => !(r && o.id === r.opId && !r.mezcla && r.valores.length === 1) && !opcionUnica(o, eleccion));
  }
  /* Una opción con un solo valor posible (p. ej. jugo de mango: solo con agua) no se pregunta */
  function opcionUnica(op, eleccion) {
    return !op.mezcla && op.valores.filter((v) => valorValido(v, eleccion)).length <= 1;
  }
  function esSimpleLinea(linea) {
    const p = linea.p;
    return !opcionesVisibles(linea).length && !p.cremas && !p.adicionales.length;
  }
  /* Sin stock hoy: lo de vitrina se puede pedir “para otro día”; lo demás (siempre disponible o por encargo) no se puede pedir */
  function paraOtroDia(p) { return p.tipo === "vitrina"; }
  function textoSinStock(p, { corto = false } = {}) {
    return paraOtroDia(p) ? (corto ? "Hoy se acabó" : "Hoy se acabó · pídelo para mañana") : "No disponible hoy";
  }
  function agotadoLinea(linea) {
    const p = linea.p;
    // (también en eventos: ahí una línea agotada no se muestra)
    const r = linea.restr;
    if (!r || r.mezcla) return agotado(p);
    return r.valores.every((v) => !entradaPara(p, eleccionInicial(p, { [r.opId]: v })).disponible);
  }
  function enLinea(l, linea) {
    if (l.producto !== linea.p.id) return false;
    const r = linea.restr;
    if (!r) return true;
    const v = (l.eleccion || {})[r.opId];
    return r.valores.includes(Array.isArray(v) ? v[0] : v);
  }
  /* Nombre del producto en el pedido y en WhatsApp. Una mezcla de sabores se muestra así:
     “Alitas mixtas x6 (BBQ + Acevichadas)”. */
  function nombreEnPedido(p, eleccion = {}) {
    const op = opcionMezcla(p);
    if (op && op.nombreMezcla && esMezcla(p, eleccion)) {
      const total = unidadesDe(p, op, eleccion);
      const sabores = eleccion[op.id].map((id) => nombreValor(p, op.id, id)).join(" + ");
      const resto = p.opciones
        .filter((o) => o.id !== op.id && o.id !== op.mezcla.cantidadDe)
        .map((o) => nombreValor(p, o.id, valorElegido(eleccion, o.id)));
      return `${op.nombreMezcla}${total ? " x" + total : ""} (${[sabores, ...resto].join(" · ")})`;
    }
    // Con sabor o tipo separado se usa el nombre de su línea en la carta: “Cheesecake de fresa”,
    // “Empanada de pollo (Sin limón · Con azúcar)”. Si varias opciones comparten línea, va el detalle completo.
    const sep = opcionSeparada(p);
    const v = sep && sep.valores.find((x) => x.id === valorElegido(eleccion, sep.id));
    if (v && v.linea && sep.valores.filter((x) => x.linea === v.linea).length === 1) {
      const resto = p.opciones
        .filter((o) => o.id !== sep.id && eleccion[o.id] !== undefined && eleccion[o.id] !== null)
        .map((o) => nombreValor(p, o.id, valorElegido(eleccion, o.id)));
      return v.linea + (resto.length ? ` (${resto.join(" · ")})` : "");
    }
    return p.nombre + (p.opciones.length ? ` (${detalleEleccion(p, eleccion)})` : "");
  }
  function cantidadLinea(linea) {
    return lineasValidas().filter((l) => enLinea(l, linea)).reduce((s, l) => s + l.cantidad, 0);
  }
  function textoBuscableLinea(linea) {
    const p = linea.p;
    const r = linea.restr;
    const valores = opcionesVisibles(linea).filter((o) => !o.secundaria).flatMap((o) => o.valores.filter((v) => !r || o.id !== r.opId || r.valores.includes(v.id)).map((v) => v.nombre));
    return normal([linea.nombre, p.nombre, p.descripcion, p.categoria, ...valores].join(" "));
  }
  function textoAnticipacion(p) {
    if (p.tipo !== "encargo" || !p.anticipacion) return "";
    // Boxes: desde X días; un modelo elaborado puede tomar hasta anticipacionMax
    return p.anticipacionMax > p.anticipacion
      ? `Por encargo · desde ${p.anticipacion} días (hasta ${p.anticipacionMax} según el modelo)`
      : `Por encargo · con ${p.anticipacion} días de anticipación`;
  }
  function textoAnticipacionLargo(p) {
    if (p.tipo !== "encargo" || !p.anticipacion) return "";
    return p.anticipacionMax > p.anticipacion
      ? `Desde ${p.anticipacion} días. Si el modelo es elaborado, puede tomar hasta ${p.anticipacionMax} días: te confirmamos la fecha por WhatsApp.`
      : `${textoAnticipacion(p)}. Coordinamos la fecha por WhatsApp.`;
  }
  /* ¿El pedido tiene algo cuya fecha queda sujeta a confirmación (boxes)? */
  function fechaPorConfirmar() { return lineasValidas().some((l) => { const p = porId.get(l.producto); return p.tipo === "encargo" && p.anticipacionMax > p.anticipacion; }); }

  /* ---------- líneas del pedido ---------- */
  function claveLinea(l) {
    return [l.producto, JSON.stringify(l.eleccion || {}), cremasLista(l.cremas).map(([n, k]) => n + ":" + k).sort().join(","), (l.adicionales || []).slice().sort().join(","), l.extra || "", l.otroDia ? 1 : 0].join("|");
  }
  function precioLinea(l) {
    const p = porId.get(l.producto);
    const base = precioBase(p, l.eleccion || {});
    let valor = base.tipo === "cotizar" ? 0 : base.valor;
    let pendiente = base.tipo !== "fijo";
    (l.adicionales || []).forEach((id) => {
      const a = adicionalPorId.get(id);
      if (!a) return;
      if (a.precio.tipo === "fijo") valor += a.precio.valor; else pendiente = true;
    });
    return { valor: Math.round(valor * 100) / 100, pendiente, base };
  }
  function lineasValidas() {
    return lineas.filter((l) => pedible(porId.get(l.producto)));
  }
  /* Una línea guardada sigue siendo válida si sus opciones existen (p. ej. ya no hay alitas bouchet) */
  function eleccionExiste(p, eleccion = {}) {
    return Object.entries(eleccion).every(([opId, v]) => {
      const op = p.opciones.find((o) => o.id === opId);
      return op && (Array.isArray(v) ? v : [v]).every((id) => op.valores.some((x) => x.id === id));
    });
  }
  function unidades() {
    return lineasValidas().reduce((s, l) => s + l.cantidad, 0);
  }
  /* Desglose de una línea: lo usan el panel “Tu pedido” y el mensaje de WhatsApp,
     así los dos muestran exactamente lo mismo. Lo “a cotizar” nunca suma al subtotal. */
  function desglose(l) {
    const p = porId.get(l.producto);
    const base = precioBase(p, l.eleccion || {});
    const fijo = base.tipo === "fijo";
    const extras = (l.adicionales || []).map((id) => adicionalPorId.get(id)).filter(Boolean).map((a) => ({
      nombre: a.pideTexto && l.extra ? `${a.nombre} (${l.extra})` : a.nombre,
      precio: a.precio.tipo === "fijo" ? a.precio.valor : null,
    }));
    const unitario = fijo ? Math.round((base.valor + extras.reduce((s, x) => s + (x.precio || 0), 0)) * 100) / 100 : null;
    const suma = fijo ? Math.round(unitario * l.cantidad * 100) / 100 : 0;
    // Cada monto ya viene multiplicado por la cantidad: la suma de los montos del detalle es el subtotal.
    const n = l.cantidad;
    const precio = fijo ? soles(base.valor * n) : base.tipo === "desde" ? `desde ${soles(base.valor)}${n > 1 ? " c/u" : ""} · a cotizar` : "a cotizar";
    const total = fijo ? "" : "No suma al subtotal: te enviamos la cotización por WhatsApp.";
    return {
      p,
      nombre: nombreEnPedido(p, l.eleccion),
      precio,
      cremas: cremasLista(l.cremas).length ? `Cremas: ${textoCremas(l.cremas)} (gratis)` : "",
      extras: extras.map((x) => ({
        texto: `+ ${n > 1 ? n + " " : ""}${x.nombre}`,
        precio: x.precio === null ? "precio a confirmar" : fijo ? soles(x.precio * n) : "se suma a la cotización",
      })),
      total,
      aviso: p.tipo === "encargo" && p.anticipacion ? (p.anticipacionMax > p.anticipacion ? `Por encargo: desde ${p.anticipacion} días; si el modelo es elaborado, hasta ${p.anticipacionMax}. Fecha sujeta a confirmación.` : `Por encargo: pídelo con ${p.anticipacion} días de anticipación.`) : p.soloLocal ? "Solo para tomar en el local." : "",
      suma,
      encargo: p.tipo === "encargo",
    };
  }
  function subtotal() {
    return lineasValidas().reduce((s, l) => s + desglose(l).suma, 0);
  }
  function lineaSimple(p, eleccion = {}) {
    return { producto: p.id, eleccion, cremas: {}, adicionales: [], extra: "", cantidad: 1, otroDia: false };
  }
  function agregarLinea(nueva) {
    const clave = claveLinea(nueva);
    const existe = lineas.find((l) => claveLinea(l) === clave);
    if (existe) existe.cantidad += nueva.cantidad; else lineas.push({ ...nueva });
    trasCambio();
    const p = porId.get(nueva.producto);
    anunciar(`Agregaste ${p.nombre}${nueva.otroDia ? " para otro día" : ""}. Tu pedido tiene ${plural(unidades(), "producto", "productos")}.`);
    latir();
  }
  function cambiarLinea(clave, delta) {
    const l = lineas.find((x) => claveLinea(x) === clave);
    if (!l) {
      // Control rápido de un producto (o sabor) simple que aún no está en el pedido
      const partes = clave.split("|");
      const p = porId.get(partes[0]);
      let eleccion = {};
      try { eleccion = JSON.parse(partes[1] || "{}"); } catch { eleccion = {}; }
      if (p && delta > 0) agregarLinea(lineaSimple(p, eleccion));
      return;
    }
    l.cantidad += delta;
    if (l.cantidad <= 0) lineas = lineas.filter((x) => x !== l);
    trasCambio();
    const p = porId.get(l.producto);
    anunciar(l.cantidad > 0 ? `${p.nombre}: ${l.cantidad}.` : `Quitaste ${p.nombre} del pedido.`);
  }
  function trasCambio() {
    enviado = null;
    guardar(CLAVE_PEDIDO, lineas);
    refrescarControles();
    pintarPedido();
  }
  /* Números que ruedan: solo los dígitos que cambian se deslizan (arriba al subir, abajo al bajar). */
  function animarNumero(el, valor, formato) {
    const texto = formato(valor);
    const anterior = el.dataset.valor !== undefined ? Number(el.dataset.valor) : null;
    const textoAnterior = el.dataset.texto ?? el.textContent;
    el.dataset.valor = valor;
    el.dataset.texto = texto;
    const quieto = anterior === null || anterior === valor || matchMedia("(prefers-reduced-motion: reduce)").matches || !el.offsetParent;
    if (quieto) { el.textContent = texto; return; }
    const dir = valor > anterior ? 1 : -1;
    // El prefijo ("S/ ") queda fijo; solo se alinean y comparan las cifras, desde la derecha.
    const [, prefijo, cifras] = texto.match(/^(\D*)(.*)$/);
    const [, prefijoAnt, cifrasAnt] = textoAnterior.match(/^(\D*)(.*)$/);
    const mismoPrefijo = prefijo === prefijoAnt;
    const nuevoTxt = mismoPrefijo ? cifras : texto;
    const viejoTxt = mismoPrefijo ? cifrasAnt : textoAnterior;
    const largo = Math.max(nuevoTxt.length, viejoTxt.length);
    const a = viejoTxt.padStart(largo, " ");
    const b = nuevoTxt.padStart(largo, " ");
    let html = mismoPrefijo && prefijo ? `<span>${esc(prefijo)}</span>` : "";
    for (let i = 0; i < largo; i++) {
      if (a[i] === b[i]) { if (b[i] !== " ") html += `<span>${esc(b[i])}</span>`; continue; }
      html += `<span class="rueda__d"><span class="rueda__v">${a[i] === " " ? "" : esc(a[i])}</span><span class="rueda__n">${b[i] === " " ? "" : esc(b[i])}</span></span>`;
    }
    el.innerHTML = `<span class="visualmente-oculto">${esc(texto)}</span><span class="rueda" aria-hidden="true">${html}</span>`;
    const curva = { duration: 300, easing: "cubic-bezier(0.32, 0.72, 0, 1)", fill: "both" };
    $$(".rueda__d", el).forEach((d, i) => {
      const retraso = { ...curva, delay: i * 18 };
      d.querySelector(".rueda__v").animate([{ transform: "translateY(0)", opacity: 1 }, { transform: `translateY(${-dir * 100}%)`, opacity: 0 }], retraso);
      d.querySelector(".rueda__n").animate([{ transform: `translateY(${dir * 100}%)`, opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], retraso);
    });
    setTimeout(() => { if (el.dataset.texto === texto) el.textContent = texto; }, 420);
  }
  function latir() {
    [$("[data-contador]")].forEach((nodo) => {
      nodo.classList.remove("late");
      void nodo.offsetWidth;
      nodo.classList.add("late");
    });
  }

  /* ---------- controles de agregar ---------- */
  function htmlControl(linea, opciones = {}) {
    const p = linea.p;
    const eleccion = eleccionInicial(p, presetDe(linea, opciones.preset));
    const sinStock = opciones.preset ? !disponible(p, eleccion) : agotadoLinea(linea);
    if (sinStock && !paraOtroDia(p)) return ""; // no disponible hoy: no se puede pedir
    if (esSimpleLinea(linea) && !sinStock && !opciones.conPrecio) {
      const clave = claveLinea(lineaSimple(p, eleccion));
      const n = lineas.find((l) => claveLinea(l) === clave)?.cantidad || 0;
      if (n > 0) {
        return `<div class="paso${opciones.claro ? " paso--claro" : ""}" role="group" aria-label="Cantidad de ${esc(linea.nombre)}">
          <button type="button" data-linea-restar="${esc(clave)}" aria-label="Quitar uno">${ICONO.menos}</button>
          <output data-num="ctl:${esc(linea.clave)}" data-num-valor="${n}">${n}</output>
          <button type="button" data-linea-sumar="${esc(clave)}" aria-label="Agregar uno más">${ICONO.mas}</button>
        </div>`;
      }
    }
    const soloCotiza = p.precios.every((e) => e.precio.tipo !== "fijo");
    const etiqueta = sinStock ? "Para mañana" : soloCotiza ? "Cotizar" : "Agregar";
    const precio = opciones.conPrecio ? ` · ${textoBase(precioBase(p, eleccion))}` : "";
    const n = cantidadLinea(linea);
    const clases = ["agregar"];
    if (soloCotiza) clases.push("agregar--cotizar");
    if (sinStock) clases.push("agregar--manana");
    const preset = opciones.preset ? ` data-preset='${esc(JSON.stringify(opciones.preset))}'` : "";
    return `<button type="button" class="${clases.join(" ")}" data-abrir="${p.id}" data-linea="${esc(linea.clave)}"${preset} aria-label="${etiqueta}: ${esc(opciones.nombre || linea.nombre)}">${ICONO.mas}<span>${etiqueta}${precio}</span>${n && !opciones.conPrecio ? `<b class="agregar__n">${n}<span class="visualmente-oculto"> en tu pedido</span></b>` : ""}</button>`;
  }
  function atributosControl(linea, opciones = {}) {
    let a = `data-control="${linea.p.id}" data-control-linea="${esc(linea.clave)}"`;
    if (opciones.claro) a += ' data-claro="1"';
    if (opciones.conPrecio) a += ' data-precio="1"';
    if (opciones.preset) a += ` data-preset='${esc(JSON.stringify(opciones.preset))}'`;
    if (opciones.nombre) a += ` data-nombre="${esc(opciones.nombre)}"`;
    return a;
  }
  function refrescarControles() {
    $$("[data-control]").forEach((nodo) => {
      const p = porId.get(nodo.dataset.control);
      if (!p) return;
      const preset = nodo.dataset.preset ? JSON.parse(nodo.dataset.preset) : undefined;
      const linea = lineaPorClave(p, nodo.dataset.controlLinea) || lineaPara(p, preset);
      nodo.innerHTML = htmlControl(linea, {
        claro: nodo.dataset.claro === "1",
        conPrecio: nodo.dataset.precio === "1",
        preset,
        nombre: nodo.dataset.nombre,
      });
    });
    animarNumerosEn(document);
  }

  /* ---------- números que cambian: un solo componente para toda la web ----------
     Cada número lleva data-num="clave" (y data-num-valor). La memoria guarda el último valor por clave,
     así el número se anima aunque el elemento se vuelva a dibujar desde cero. */
  const memoriaNumeros = new Map();
  const FORMATOS = { soles, entero: String };
  function numero(el, clave, valor, formato = String) {
    if (!el) return;
    const previo = memoriaNumeros.get(clave);
    if (previo && el.dataset.texto === undefined) {
      el.dataset.valor = previo.valor;
      el.dataset.texto = previo.texto;
    }
    animarNumero(el, valor, formato);
    memoriaNumeros.set(clave, { valor, texto: formato(valor) });
  }
  function animarNumerosEn(raiz) {
    $$("[data-num]", raiz).forEach((el) => {
      numero(el, el.dataset.num, Number(el.dataset.numValor), FORMATOS[el.dataset.numFormato] || String);
    });
  }
  function olvidarNumeros(prefijos) {
    [...memoriaNumeros.keys()].forEach((k) => { if (prefijos.some((p) => k.startsWith(p))) memoriaNumeros.delete(k); });
  }

  /* ---------- portada y vitrina ---------- */
  function pintarPortada() {
    const nodo = $("[data-portada-agregar]");
    const p = porId.get("alitas");
    if (!nodo || !p) return;
    const opciones = { conPrecio: true, preset: { cantidad: "x6", sabor: "acevichadas" }, nombre: "Alitas acevichadas" };
    nodo.className = "portada__agregar";
    const linea = lineaPara(p, opciones.preset);
    nodo.setAttribute("data-control", p.id);
    nodo.dataset.controlLinea = linea.clave;
    nodo.dataset.precio = "1";
    nodo.dataset.preset = JSON.stringify(opciones.preset);
    nodo.dataset.nombre = opciones.nombre;
    nodo.innerHTML = htmlControl(linea, opciones);
    nodo.hidden = false;
  }
  function htmlFoto(foto, nombre, prioridad) {
    if (foto) {
      return `<img src="${esc(foto.src)}" alt="${esc(nombre)}" width="1200" height="1600" ${prioridad === "alta" ? 'fetchpriority="high"' : prioridad ? "" : 'loading="lazy"'} decoding="async" data-foto>`;
    }
    return htmlPronto("claro");
  }
  /* Misifu sosteniendo su cartel con texto real. El color de las líneas se adapta al fondo:
     "claro" = líneas moradas sobre lila; "oscuro" = líneas blancas sobre morado o carbón. */
  function htmlPronto(tono) {
    return `<div class="pronto pronto--${tono}">
      <div class="pronto__figura">
        <span class="pronto__misifu" aria-hidden="true"></span>
        <span class="pronto__cartel">Pronto su foto</span>
      </div>
    </div>`;
  }
  function htmlPieza(linea, opciones = {}) {
    const p = linea.p;
    const eleccion = eleccionInicial(p, presetDe(linea, opciones.preset));
    const nombre = opciones.nombre || linea.nombre;
    const precio = opciones.preset || esSimpleLinea(linea) ? textoBase(precioBase(p, eleccion)) : rangoPrecios(p, linea.restr).texto;
    const sinStock = opciones.preset ? !disponible(p, eleccion) : agotadoLinea(linea);
    const ctl = { conPrecio: opciones.vitrina, preset: opciones.preset, nombre: opciones.nombre };
    return `<li class="pieza${opciones.vitrina ? " pieza--vitrina" : ""}${sinStock ? " pieza--agotada" : ""}" data-id="${p.id}" data-linea="${esc(linea.clave)}" data-buscar="${esc(textoBuscableLinea(linea))}">
      <div class="pieza__foto">
        ${htmlFoto(fotoDe(p, eleccion), nombre, opciones.prioridad)}
        ${sinStock ? `<span class="sello">${textoSinStock(p)}</span>` : ""}
        <div class="pieza__agregar" ${atributosControl(linea, ctl)}>${htmlControl(linea, ctl)}</div>
      </div>
      <div class="pieza__texto">
        <p class="pieza__nombre">${esc(nombre)}</p>
        ${opciones.vitrina ? "" : `<span class="pieza__precio">${precio}</span>`}
      </div>
    </li>`;
  }
  let vitrinaConectada = false;
  function pintarVitrina() {
    const fila = $("[data-vitrina-fila]");
    fila.innerHTML = masPedidos.filter((m) => enCarta(porId.get(m.producto))).map((m, i) => {
      const p = porId.get(m.producto);
      return htmlPieza(lineaPara(p, m.eleccion || {}), { prioridad: i < 2 ? "alta" : "normal", vitrina: true, preset: m.eleccion, nombre: m.nombre });
    }).join("");
    pintarTemporada();
    if (vitrinaConectada) return;
    vitrinaConectada = true;
    conectarCarrusel(fila, $$("[data-vitrina]"), 0.75);
  }
  /* Temporada: sección destacada aparte, solo cuando tiene algo que pedir hoy
     (en vitrina, al menos un producto con la casilla “disponible” marcada en la hoja). */
  function pintarTemporada() {
    const seccion = $("[data-temporada]");
    if (!seccion) return;
    const destacadas = categorias.filter((c) => c.destacada);
    const html = destacadas.map((c) => {
      const items = productos.filter((p) => p.categoria === c.nombre && pedible(p) && !agotado(p)).flatMap(lineasDe).filter((l) => !agotadoLinea(l));
      if (!items.length) return "";
      return `<div class="temporada__grupo">
        <div class="temporada__cabeza">
          <p class="temporada__sello">${esc(c.nombre)}</p>
          <h2 class="temporada__titulo">${esc(items.length === 1 ? items[0].nombre : "Llegó la temporada")}</h2>
          ${c.nota ? `<p class="temporada__nota">${esc(c.nota)}</p>` : ""}
        </div>
        <ul class="temporada__fila">${items.map((l) => htmlPieza(l)).join("")}</ul>
      </div>`;
    }).join("");
    seccion.innerHTML = html;
    seccion.hidden = !html;
  }
  function conectarCarrusel(fila, flechas, paso) {
    const marco = fila.closest("[data-carrusel]") || fila.parentElement;
    // Velos de desvanecido de los bordes (solo la vitrina los tiene)
    const velos = [...marco.querySelectorAll(":scope > [data-velo]")];
    const opacidadVelo = velos.map(() => "");
    const actualizar = () => {
      // Primero se lee todo y después se escribe: leer después de escribir obliga a recalcular a mitad de cuadro
      const max = fila.scrollWidth - fila.clientWidth;
      const x = fila.scrollLeft;
      if (flechas[0]) flechas[0].disabled = x < 8;
      if (flechas[1]) flechas[1].disabled = x > max - 8;
      marco.classList.toggle("con-desborde", max > 8);
      marco.classList.toggle("en-inicio", x < 8);
      marco.classList.toggle("en-final", x > max - 8);
      if (!velos.length) return;
      // Intensidad de cada velo (0 a 1): crece con lo que queda por deslizar hacia ese lado.
      // Se escribe solo si cambió: en el medio del recorrido ambos valen 1 y no hay nada que tocar.
      const rampa = 56;
      const valores = max > 8 ? [Math.min(1, x / rampa), Math.min(1, Math.max(0, max - x) / rampa)] : [0, 0];
      velos.forEach((v, i) => {
        const o = valores[i].toFixed(3);
        if (o !== opacidadVelo[i]) { opacidadVelo[i] = o; v.style.opacity = o; }
      });
    };
    flechas.forEach((b) => b.addEventListener("click", () => {
      fila.scrollBy({ left: Number(b.dataset.dir) * fila.clientWidth * paso, behavior: "smooth" });
    }));
    fila.addEventListener("scroll", actualizar, { passive: true });
    window.addEventListener("resize", actualizar);
    requestAnimationFrame(actualizar);
    return actualizar;
  }

  /* ---------- carta ---------- */
  /* Resumen de lo que se elige en el panel (sin sabores ya fijados ni helada/azúcar) */
  function resumenOpciones(linea) {
    const r = linea.restr;
    const base = eleccionInicial(linea.p, linea.preset);
    return opcionesVisibles(linea)
      .filter((o) => !o.secundaria && !(r && r.mezcla && o.id === r.opId))
      .map((o) => o.valores.filter((v) => (!r || o.id !== r.opId || r.valores.includes(v.id)) && valorValido(v, base)))
      .filter((vs) => vs.length > 1)
      .map((vs) => vs.map((v) => v.nombre).join(", "))
      .join(" · ");
  }
  function precioDeLinea(linea) {
    const p = linea.p;
    return esSimpleLinea(linea) ? textoBase(precioBase(p, eleccionInicial(p, linea.preset))) : rangoPrecios(p, linea.restr).texto;
  }
  /* Foto propia de la línea (sin foto propia: Misifu) */
  function fotoPropiaDe(linea) {
    const f = fotoDe(linea.p, eleccionInicial(linea.p, linea.preset));
    return f ? f.src : "";
  }
  /* Miniatura cuadrada de cada fila (celular y tablet). Al tocarla:
     - sin opciones y con foto: la foto se agranda en el centro (data-zoom);
     - con opciones: hace lo mismo que el “+” (abre su hoja de opciones);
     - sin opciones y sin foto: es solo imagen (Misifu con su cartel). */
  function htmlMini(linea, fotoPropia) {
    const dentro = fotoPropia
      ? `<img src="${esc(fotoPropia)}" alt="" width="1200" height="1600" loading="lazy" decoding="async">`
      : htmlPronto("claro");
    if (!esSimpleLinea(linea)) return `<button type="button" class="fila__mini" data-mini-opciones tabindex="-1" aria-hidden="true">${dentro}</button>`;
    if (fotoPropia) return `<button type="button" class="fila__mini" data-zoom aria-label="Ver foto de ${esc(linea.nombre)}">${dentro}</button>`;
    return `<span class="fila__mini" aria-hidden="true">${dentro}</span>`;
  }
  const ETIQUETA_LOCAL = '<span class="etiqueta-local">Solo en el local</span>';
  function htmlFila(linea) {
    const p = linea.p;
    const r = linea.restr;
    const sinStock = agotadoLinea(linea);
    // Boxes: el texto completo (desde X días, hasta Y si el modelo es elaborado)
    const anticipa = p.anticipacionMax > p.anticipacion ? esc(textoAnticipacionLargo(p)) : textoAnticipacion(p);
    const precio = precioDeLinea(linea);
    const desc = r && r.mezcla ? "Elige 2 sabores, mitad y mitad." : p.descripcion;
    const resumen = resumenOpciones(linea);
    // Foto propia de la línea: miniatura en celular y vista previa al pasar el mouse.
    // Sin foto, la miniatura y la vista previa muestran a Misifu con “Pronto su foto”.
    const fotoPropia = fotoPropiaDe(linea);
    const datosFoto = ` data-foto-src="${esc(fotoPropia)}" data-foto-nombre="${esc(linea.nombre)}"`;
    return `<li class="fila fila--con-foto${sinStock ? " fila--agotada" : ""}" data-id="${p.id}" data-linea="${esc(linea.clave)}" data-buscar="${esc(textoBuscableLinea(linea))}"${datosFoto}>
      ${htmlMini(linea, fotoPropia)}
      <div class="fila__texto">
        <p class="fila__linea">
          <span class="fila__nombre">${esc(linea.nombre)}</span>
          <span class="fila__puntos" aria-hidden="true"></span>
          <span class="fila__precio">${precio}</span>
        </p>
        ${desc ? `<p class="fila__desc">${esc(desc)}</p>` : ""}
        ${resumen ? `<p class="fila__opciones">${esc(resumen)}</p>` : ""}
        ${p.soloLocal ? `<p class="fila__etiquetas">${ETIQUETA_LOCAL}</p>` : ""}
        ${sinStock ? `<p class="fila__estado fila__estado--agotado">${textoSinStock(p)}</p>` : ""}
        ${anticipa ? `<p class="fila__estado">${anticipa}</p>` : ""}
      </div>
      <div class="fila__control" ${atributosControl(linea, { claro: true })}>${htmlControl(linea, { claro: true })}</div>
    </li>`;
  }
  function lineasDeCategoria(c) {
    return productos.filter((p) => p.categoria === c.nombre && enCarta(p)).flatMap(lineasDe);
  }
  function categoriasDeCarta() {
    return categorias.filter((c) => !c.destacada && productos.some((p) => p.categoria === c.nombre && enCarta(p)));
  }
  /* Foto grande de la categoría: solo vitrina visual (foto y nombre, sin botón). Todos los productos
     están en la lista de la derecha; al pasar el mouse por una línea con foto, la foto cambia. */
  function htmlMuestra(linea) {
    const foto = fotoDe(linea.p, eleccionInicial(linea.p, linea.preset));
    return `<div class="grupo__portada" aria-hidden="true">
      <div class="pieza pieza--muestra">
        <div class="pieza__foto">${htmlFoto(foto, linea.nombre)}</div>
        <div class="pieza__texto"><p class="pieza__nombre">${esc(linea.nombre)}</p></div>
      </div>
    </div>`;
  }
  let activa = null;
  let actualizarChips = null;
  function pintarCarta() {
    const cuerpo = $("[data-carta]");
    const chips = $("[data-categorias]");
    const conItems = categoriasDeCarta();
    const promo = promoActiva();
    cuerpo.innerHTML = conItems.map((c, indice) => {
      const items = lineasDeCategoria(c);
      const foto = (l) => fotoDe(l.p, eleccionInicial(l.p, l.preset));
      const portada = items.find((l) => foto(l) && !agotadoLinea(l)) || items.find((l) => foto(l));
      const siguiente = conItems[indice + 1];
      const conPromo = promo && esCategoriaPromo(c);
      return `<section class="grupo${c.eventos ? " grupo--eventos" : ""}${portada ? " grupo--portada" : ""}" id="${c.id}" aria-labelledby="t-${c.id}">
        <div class="grupo__cabeza">
          <h3 id="t-${c.id}">${esc(c.nombre)}${conPromo ? ` <span class="promo-etiqueta">2x1 hasta las ${esc(textoHora(minutosDe(PROMO.hasta)))}</span>` : ""}</h3>
          ${c.nota ? `<p class="grupo__nota">${esc(c.nota)}</p>` : ""}
          ${conPromo ? `<p class="grupo__promo">De ${esc(textoHora(minutosDe(PROMO.desde)))} a ${esc(textoHora(minutosDe(PROMO.hasta)))}: por cada 2 tragos, el de menor precio va gratis. Se aplica solo en tu pedido.</p>` : ""}
        </div>
        <div class="grupo__cuerpo">
          ${portada ? htmlMuestra(portada) : ""}
          <ul class="lista">${items.map(htmlFila).join("")}</ul>
        </div>
        ${siguiente ? `<a class="grupo__siguiente enlace-flecha" href="#${siguiente.id}" data-ir-categoria="${siguiente.id}">Seguir con ${esc(siguiente.nombre)} ${ICONO.flecha}</a>` : ""}
      </section>`;
    }).join("");
    chips.innerHTML = conItems.map((c) => `<li><a href="#${c.id}" data-chip="${c.id}"${promo && esCategoriaPromo(c) ? ' class="chip--promo"' : ""}>${esc(c.nombre)}${promo && esCategoriaPromo(c) ? '<span class="chip__promo">2x1</span>' : ""}</a></li>`).join("");
    if (!activa || !document.getElementById(activa)) activa = conItems[0]?.id || null;
    buscar($("[data-buscador]").value);
    marcarChip(false);
    if (actualizarChips) actualizarChips();
    pintarTodas();
  }

  /* Vista previa en computadora: al pasar el mouse (o enfocar con teclado) por una línea con foto propia,
     la foto grande cambia con un fundido a la de esa línea. Si la línea no tiene foto, aparece Misifu
     con “Pronto su foto” con el mismo fundido. */
  const conVistaPrevia = () => matchMedia("(min-width: 60rem) and (hover: hover)").matches;
  function vistaPrevia(grupo, fila) {
    const pieza = $(".grupo__portada .pieza", grupo);
    const marco = pieza && $(".pieza__foto", pieza);
    if (!marco || fila.dataset.fotoSrc === undefined) return;
    const src = fila.dataset.fotoSrc;
    const clave = src || "pronto";
    $(".pieza__nombre", pieza).textContent = fila.dataset.fotoNombre;
    if (!marco.dataset.activa) {
      // La primera vez, lo que se ve es la portada original
      const original = $("img[data-foto]", marco);
      marco.dataset.activa = original ? original.getAttribute("src") : "pronto";
    }
    if (marco.dataset.activa === clave) return;
    marco.dataset.activa = clave;
    // Capa nueva encima, con fundido; las anteriores se quitan cuando la nueva ya se ve
    let capa;
    if (src) {
      capa = document.createElement("img");
      capa.alt = "";
      capa.decoding = "async";
      capa.src = src;
    } else {
      capa = document.createElement("div");
      capa.innerHTML = htmlPronto("claro");
    }
    capa.className = "pieza__capa";
    marco.appendChild(capa);
    const viejas = $$(".pieza__capa", marco).filter((c) => c !== capa);
    const mostrar = () => requestAnimationFrame(() => {
      capa.classList.add("visible");
      setTimeout(() => viejas.forEach((c) => c.remove()), 400);
    });
    if (!src || capa.complete) mostrar(); else capa.addEventListener("load", mostrar, { once: true });
    if (src) capa.addEventListener("error", () => capa.remove(), { once: true });
  }
  function conectarVistaPrevia() {
    const cuerpo = $("[data-carta]");
    const entrar = (e) => {
      if (!conVistaPrevia()) return;
      const fila = e.target.closest(".fila");
      const grupo = e.target.closest(".grupo--portada");
      if (fila && grupo) vistaPrevia(grupo, fila);
    };
    cuerpo.addEventListener("mouseover", entrar);
    cuerpo.addEventListener("focusin", entrar);
    // Miniaturas de las filas: agrandar la foto o, si tiene opciones, lo mismo que el “+”
    cuerpo.addEventListener("click", (e) => {
      const z = e.target.closest("[data-zoom]");
      if (z) { abrirZoom(z); return; }
      const o = e.target.closest("[data-mini-opciones]");
      if (o) $(".fila__control [data-abrir]", o.closest(".fila"))?.click();
    });
    conectarZoom();
  }

  /* ---------- Foto agrandada (miniaturas de la carta) ----------
     La foto crece desde la miniatura hasta el centro (FLIP: solo transform) y el fondo se desenfoca
     con un fundido de opacidad (el desenfoque no se anima). Se cierra tocando fuera, con la X, con
     Escape o deslizando hacia abajo: mientras el dedo baja, la foto lo sigue 1:1 y el fondo se aclara
     al mismo ritmo; al cerrar, vuelve a encogerse hasta su miniatura. */
  const zoom = { origen: null, cerrando: false, ignorarClicHasta: 0 };
  const reducido = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  function zoomPartes() {
    const d = $("[data-zoom-dialogo]");
    return { d, caja: $("[data-zoom-caja]", d), foto: $("[data-zoom-foto]", d), fondo: $(".zoom__fondo", d) };
  }
  // Transformación que lleva la foto grande (r1) encima de la miniatura (r0); origen arriba a la izquierda
  function flip(r0, r1) {
    return `translate(${(r0.left - r1.left).toFixed(1)}px, ${(r0.top - r1.top).toFixed(1)}px) scale(${(r0.width / r1.width).toFixed(4)})`;
  }
  function abrirZoom(boton) {
    const { d, caja, foto, fondo } = zoomPartes();
    if (d.open) return;
    const fila = boton.closest(".fila");
    $$("img", foto).forEach((x) => x.remove());
    const img = document.createElement("img");
    img.src = fila.dataset.fotoSrc;
    img.alt = fila.dataset.fotoNombre;
    img.decoding = "async";
    foto.prepend(img);
    $("[data-zoom-nombre]", d).textContent = fila.dataset.fotoNombre;
    $("[data-zoom-precio]", d).textContent = $(".fila__precio", fila)?.textContent || "";
    zoom.origen = boton;
    zoom.cerrando = false;
    caja.style.transform = "";
    fondo.style.opacity = "";
    d.showModal();
    if (!reducido()) {
      const r0 = boton.getBoundingClientRect();
      const r1 = foto.getBoundingClientRect();
      foto.style.transition = "none";
      foto.style.transform = flip(r0, r1);
      void foto.offsetWidth;
    }
    boton.style.visibility = "hidden"; // la miniatura “se levanta” de su sitio
    requestAnimationFrame(() => {
      foto.style.transition = "";
      foto.style.transform = "";
      d.classList.add("abierto");
      $(".zoom__cerrar", d).focus({ preventScroll: true });
    });
  }
  function cerrarZoom() {
    const { d, caja, foto, fondo } = zoomPartes();
    if (!d.open || zoom.cerrando) return;
    zoom.cerrando = true;
    const b = zoom.origen;
    d.classList.remove("abierto");
    fondo.style.transition = "";
    fondo.style.opacity = "";
    const r0 = b && b.isConnected ? b.getBoundingClientRect() : null;
    const seVe = r0 && r0.width && r0.bottom > 0 && r0.top < innerHeight;
    let tiempo = 180;
    if (reducido() || !seVe) {
      foto.style.transition = "opacity 180ms ease";
      foto.style.opacity = "0";
    } else {
      // Si se cierra mientras todavía crece, se parte de su lugar sin transformar (la transición
      // retoma desde donde va, sin salto)
      const r = foto.getBoundingClientRect();
      const t = new DOMMatrix(getComputedStyle(foto).transform);
      const r1 = { left: r.left - t.e, top: r.top - t.f, width: r.width / (t.a || 1) };
      tiempo = 320;
      foto.style.transition = "transform 320ms var(--entra)";
      foto.style.transform = flip(r0, r1);
    }
    setTimeout(() => {
      d.close();
      ["transition", "transform", "opacity"].forEach((p) => { foto.style[p] = ""; });
      caja.style.transition = "";
      caja.style.transform = "";
      if (b) { b.style.visibility = ""; if (b.isConnected) b.focus({ preventScroll: true }); }
      zoom.origen = null;
      zoom.cerrando = false;
    }, tiempo);
  }
  function conectarZoom() {
    const { d, caja, fondo } = zoomPartes();
    d.addEventListener("cancel", (e) => { e.preventDefault(); cerrarZoom(); });
    d.addEventListener("click", (e) => {
      if (Date.now() < zoom.ignorarClicHasta) return; // el dedo que suelta un arrastre no “toca”
      if (e.target.closest("[data-zoom-cerrar]")) cerrarZoom();
    });
    d.addEventListener("wheel", (e) => e.preventDefault(), { passive: false });
    let g = null;
    d.addEventListener("pointerdown", (e) => {
      g = null;
      if (zoom.cerrando || !d.classList.contains("abierto") || e.target.closest("button") || !e.isPrimary) return;
      g = { y0: e.clientY, y: 0, arrastra: false, id: e.pointerId, muestras: [] };
    });
    d.addEventListener("pointermove", (e) => {
      if (!g || e.pointerId !== g.id) return;
      const dy = e.clientY - g.y0;
      if (!g.arrastra) {
        if (Math.abs(dy) < 6) return;
        g.arrastra = true;
        g.base = dy; // empieza desde donde está el dedo, sin salto
        try { d.setPointerCapture(e.pointerId); } catch {}
        caja.style.transition = "none";
        fondo.style.transition = "none";
      }
      let y = dy - g.base;
      if (y < 0) y = -Math.min(24, Math.sqrt(-y) * 2); // hacia arriba: resistencia, no pared
      g.y = y;
      g.muestras.push({ y, t: e.timeStamp });
      while (g.muestras.length > 2 && e.timeStamp - g.muestras[0].t > 100) g.muestras.shift();
      caja.style.transform = `translateY(${y.toFixed(1)}px)`;
      fondo.style.opacity = String(Math.max(0, 1 - Math.max(0, y) / (innerHeight * 0.5)).toFixed(3));
    });
    const soltar = () => {
      if (!g) return;
      const arrastro = g.arrastra;
      const { y, muestras: m } = g;
      g = null;
      if (!arrastro) return;
      zoom.ignorarClicHasta = Date.now() + 400;
      const a = m[0];
      const b = m[m.length - 1];
      const velocidad = a && b && b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0; // px por ms
      if (y > caja.offsetHeight / 3 || (velocidad > 0.45 && y > 16)) { cerrarZoom(); return; }
      caja.style.transition = "transform 400ms var(--entra)";
      caja.style.transform = "";
      fondo.style.transition = "";
      fondo.style.opacity = "";
    };
    d.addEventListener("pointerup", soltar);
    d.addEventListener("pointercancel", soltar);
  }
  function marcarChip(suave = true) {
    const lista = $("[data-categorias]");
    const buscando = Boolean($("[data-buscador]").value.trim());
    $$("[data-chip]").forEach((a) => {
      const esta = a.dataset.chip === activa && !buscando;
      a.setAttribute("aria-current", String(esta));
      if (esta) {
        const desfase = a.getBoundingClientRect().left - lista.getBoundingClientRect().left;
        const primero = a.parentElement === lista.firstElementChild;
        lista.scrollTo({ left: primero ? 0 : Math.max(0, lista.scrollLeft + desfase - 56), behavior: suave ? "smooth" : "auto" });
      }
    });
  }
  function elegirCategoria(id, desplazar) {
    if (!document.getElementById(id)) return;
    activa = id;
    $("[data-buscador]").value = "";
    buscar("");
    marcarChip();
    if (desplazar) {
      const cabecera = $(".cabecera").offsetHeight;
      const tope = $("#carta .categorias").getBoundingClientRect().top;
      if (tope < cabecera - 1 || tope > innerHeight * 0.6) {
        window.scrollTo({ top: scrollY + $("#carta").getBoundingClientRect().top - cabecera + 1, behavior: "smooth" });
      }
    }
  }
  function buscar(consulta) {
    const q = normal(consulta.trim());
    $("#carta").classList.toggle("carta--buscando", Boolean(q));
    let visibles = 0;
    $$(".grupo").forEach((grupo) => {
      let enGrupo = 0;
      $$("[data-buscar]", grupo).forEach((item) => {
        const ok = !q || item.dataset.buscar.includes(q);
        item.hidden = !ok;
        if (ok) enGrupo++;
      });
      if (!q && grupo.id !== activa) enGrupo = 0;
      grupo.hidden = enGrupo === 0;
      // Al buscar se muestran solo las líneas que coinciden, sin la foto grande
      grupo.classList.toggle("grupo--portada", Boolean($(".grupo__portada", grupo)) && !q);
      visibles += enGrupo;
    });
    // Lo de eventos no está en la carta: si coincide, se avisa dónde encontrarlo
    const deEvento = q ? productos.filter((p) => p.tipo === "evento").flatMap(lineasDe).filter((l) => !agotadoLinea(l) && textoBuscableLinea(l).includes(q)) : [];
    const nombresEvento = [...new Set(deEvento.map((l) => l.nombre))];
    const enEventos = nombresEvento.length
      ? `${visibles ? "También" : "Lo encontramos"} en las opciones para eventos: ${esc(nombresEvento.slice(0, 3).join(", "))}${nombresEvento.length > 3 ? " y más" : ""}. <a href="#eventos" data-ir-eventos>Ver opciones para tu evento</a>.`
      : "";
    const vacio = $("[data-vacio]");
    vacio.hidden = visibles > 0 && !enEventos;
    if (!visibles) {
      vacio.innerHTML = enEventos || `No encontramos “${esc(consulta.trim())}” en la carta. <a href="${urlWhatsApp("¡Hola, La Rejita Gourmet! ¿Tienen " + consulta.trim() + "?")}" target="_blank" rel="noopener">Pregúntanos por WhatsApp</a>.`;
    } else if (enEventos) {
      vacio.innerHTML = enEventos;
    }
  }

  /* ---------- panel “Todas las categorías” ---------- */
  const todas = { panel: null, boton: null, fondo: null, abierto: false, relojAbrir: 0, relojCerrar: 0, modoHover: false };
  const esEscritorio = () => matchMedia("(min-width: 52rem)").matches;
  const conCursor = () => matchMedia("(hover: hover) and (pointer: fine)").matches;

  function pintarTodas() {
    const lista = $("[data-todas-lista]");
    if (!lista) return;
    const conItems = categoriasDeCarta();
    lista.innerHTML = conItems.map((c, i) => {
      const n = lineasDeCategoria(c).length;
      return `<li style="--i:${i}"><button type="button" class="todas__item${c.id === activa ? " todas__item--activa" : ""}" data-todas-ir="${c.id}" ${c.id === activa ? 'aria-current="true"' : ""}>
        <span class="todas__nombre">${esc(c.nombre)}</span>
        <span class="todas__cuenta">${plural(n, "producto", "productos")}</span>
      </button></li>`;
    }).join("");
  }
  function abrirTodas({ porCursor = false, enfocar = false } = {}) {
    clearTimeout(todas.relojCerrar);
    if (todas.abierto) return;
    pintarTodas();
    todas.abierto = true;
    todas.modoHover = porCursor;
    todas.panel.hidden = false;
    todas.fondo.hidden = false;
    document.documentElement.classList.add("sin-scroll");
    todas.boton.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => requestAnimationFrame(() => {
      todas.panel.classList.add("visible");
      todas.fondo.classList.add("visible");
    }));
    if (enfocar) setTimeout(() => ($(".todas__item--activa", todas.panel) || $(".todas__item", todas.panel))?.focus({ preventScroll: true }), 60);
  }
  function cerrarTodas({ devolverFoco = false } = {}) {
    clearTimeout(todas.relojAbrir);
    if (!todas.abierto) return;
    todas.abierto = false;
    todas.panel.classList.remove("visible");
    todas.fondo.classList.remove("visible");
    todas.boton.setAttribute("aria-expanded", "false");
    document.documentElement.classList.remove("sin-scroll");
    setTimeout(() => { if (!todas.abierto) { todas.panel.hidden = true; todas.fondo.hidden = true; } }, 290);
    if (devolverFoco) todas.boton.focus({ preventScroll: true });
  }
  function prepararTodas() {
    todas.panel = $("[data-todas]");
    todas.boton = $("[data-todas-boton]");
    todas.fondo = $("[data-todas-fondo]");
    if (!todas.panel || !todas.boton) return;

    todas.boton.addEventListener("click", () => {
      if (todas.abierto && !todas.modoHover) cerrarTodas();
      else if (todas.abierto) todas.modoHover = false; // el clic “fija” un panel abierto por cursor
      else abrirTodas({ enfocar: !conCursor() || !esEscritorio() });
    });
    // En computadora se abre al pasar el cursor, con una pequeña pausa para no abrirse sin querer
    const entrar = () => {
      if (!conCursor() || !esEscritorio()) return;
      clearTimeout(todas.relojCerrar);
      if (!todas.abierto) todas.relojAbrir = setTimeout(() => abrirTodas({ porCursor: true }), 180);
    };
    const salir = () => {
      if (!conCursor() || !esEscritorio()) return;
      clearTimeout(todas.relojAbrir);
      // Un panel ya abierto se queda: se cierra con la X, el fondo, Esc o al elegir
    };
    [todas.boton, todas.panel].forEach((n) => { n.addEventListener("mouseenter", entrar); n.addEventListener("mouseleave", salir); });

    todas.panel.addEventListener("click", (e) => {
      const ir = e.target.closest("[data-todas-ir]");
      if (ir) {
        cerrarTodas();
        elegirCategoria(ir.dataset.todasIr, true);
        history.replaceState(null, "", "#" + ir.dataset.todasIr);
        return;
      }
      if (e.target.closest("[data-todas-cerrar]")) cerrarTodas({ devolverFoco: true });
    });
    todas.fondo.addEventListener("click", () => cerrarTodas());
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && todas.abierto) cerrarTodas({ devolverFoco: true }); });
    document.addEventListener("click", (e) => {
      // (el fondo oscuro recibe el clic de afuera y cierra el panel)
    });
    window.addEventListener("resize", () => { if (todas.abierto) cerrarTodas(); });
    deslizarParaCerrar({
      hoja: todas.panel,
      abierta: () => todas.abierto,
      desplazable: () => todas.panel,
      fondo: {
        sinTransicion: () => todas.fondo.style.setProperty("transition", "none", "important"),
        progreso: (p) => todas.fondo.style.setProperty("opacity", p.toFixed(3), "important"),
        limpiar: () => { todas.fondo.style.removeProperty("transition"); todas.fondo.style.removeProperty("opacity"); },
      },
      cerrar: () => cerrarTodas(),
    });
  }

  /* ---------- hoja de opciones de un producto ---------- */
  const hojaProducto = $("[data-producto]");
  let borrador = null;

  /* destino "pedido" = Tu pedido; "evento" = la lista “Elegiste:” del formulario de eventos.
     Si la línea ya está en esa lista, el panel se abre para editarla (con su cantidad y sus opciones). */
  function listaDe(destino) { return destino === "evento" ? lineasEvento : lineas; }
  function abrirProducto(id, preset, claveLineaCarta, { destino = "pedido", nuevo = false } = {}) {
    const p = porId.get(id);
    if (!p) return;
    const linea = (claveLineaCarta && lineaPorClave(p, claveLineaCarta)) || lineaPara(p, preset || {});
    let eleccion = eleccionInicial(p, presetDe(linea, preset));
    // Sin nada que elegir (p. ej. “Cheesecake de fresa”): se agrega directo
    if (esSimpleLinea(linea) && disponible(p, eleccion)) {
      if (destino === "evento") agregarEvento(lineaSimple(p, eleccion)); else agregarLinea(lineaSimple(p, eleccion));
      return;
    }
    const r = linea.restr;
    const opM = opcionMezcla(p);
    let mezclaActiva = null;
    const existentes = nuevo ? [] : listaDe(destino).filter((l) => enLinea(l, linea) && (!r || !r.mezcla || esMezcla(p, l.eleccion || {})));
    const editar = existentes[existentes.length - 1] || null;
    if (editar) {
      const guardada = JSON.parse(JSON.stringify(editar.eleccion || {}));
      eleccion = { ...eleccionInicial(p, guardada), ...guardada };
      if (opM && Array.isArray(eleccion[opM.id]) && eleccion[opM.id].length > 1) mezclaActiva = opM.id;
      else if (r && r.mezcla) mezclaActiva = r.opId;
    } else if (r && r.mezcla) {
      mezclaActiva = r.opId;
      const pedido = preset && Array.isArray(preset[r.opId]) ? preset[r.opId] : [];
      eleccion[r.opId] = pedido.length ? pedido.slice(0, 2) : [];
    }
    borrador = editar
      ? { producto: p.id, linea, eleccion, cremas: Object.fromEntries(cremasLista(editar.cremas)), adicionales: [...(editar.adicionales || [])], extra: editar.extra || "", cantidad: editar.cantidad, mezclaActiva, destino, editando: claveLinea(editar), otros: existentes.length - 1 }
      : { producto: p.id, linea, eleccion, cremas: {}, adicionales: [], extra: "", cantidad: 1, mezclaActiva, destino, editando: null, otros: 0 };
    mediaActual = null;
    olvidarNumeros(["borrador-", "crema:"]);
    pintarHojaProducto();
    $("[data-producto-cuerpo]", hojaProducto).scrollTop = 0;
    abrirDialogo(hojaProducto);
  }
  /* Cambiar una línea ya agregada por su versión editada (si queda igual a otra, se juntan) */
  function reemplazarLinea(destino, claveVieja, nueva) {
    const lista = listaDe(destino);
    const i = lista.findIndex((l) => claveLinea(l) === claveVieja);
    const claveNueva = claveLinea(nueva);
    const otra = lista.find((l, j) => j !== i && claveLinea(l) === claveNueva);
    if (otra) { otra.cantidad += nueva.cantidad; if (i >= 0) lista.splice(i, 1); }
    else if (i >= 0) lista[i] = { ...nueva };
    else lista.push({ ...nueva });
    if (destino === "evento") trasCambioEvento(); else trasCambio();
    anunciar(`Actualizamos ${porId.get(nueva.producto).nombre}.`);
  }
  function quitarLinea(destino, clave) {
    const l = listaDe(destino).find((x) => claveLinea(x) === clave);
    if (!l) return;
    if (destino === "evento") { lineasEvento = lineasEvento.filter((x) => x !== l); trasCambioEvento(); }
    else { lineas = lineas.filter((x) => x !== l); trasCambio(); }
    anunciar(`Quitaste ${porId.get(l.producto).nombre} ${destino === "evento" ? "de tu evento" : "del pedido"}.`);
  }

  /* Cabecera visual de la hoja de opciones: siempre ocupa el mismo alto.
     Con foto muestra la foto (y la cambia con un fundido); sin foto, a Misifu con su cartel. */
  let mediaActual = null;
  function pintarMedia(foto, nombre) {
    const caja = $("[data-producto-media]", hojaProducto);
    const clave = foto ? foto.src : "pronto";
    if (clave === mediaActual) return;
    const primera = mediaActual === null;
    mediaActual = clave;
    const nueva = document.createElement("div");
    nueva.className = "opciones__capa";
    nueva.innerHTML = foto
      ? `<img src="${esc(foto.src)}" alt="${esc(nombre)}" width="1200" height="1600" decoding="async">`
      : htmlPronto("claro");
    // Si la foto no llega (servidor caído, conexión lenta), se muestra a Misifu en lugar de un ícono roto.
    const img = nueva.querySelector("img");
    if (img) {
      const reemplazar = () => { nueva.innerHTML = htmlPronto("claro"); };
      img.addEventListener("error", reemplazar, { once: true });
      if (img.complete && img.naturalWidth === 0 && img.getAttribute("src")) reemplazar();
    }
    if (primera || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      caja.replaceChildren(nueva);
      return;
    }
    nueva.classList.add("opciones__capa--entra");
    caja.appendChild(nueva);
    requestAnimationFrame(() => requestAnimationFrame(() => nueva.classList.remove("opciones__capa--entra")));
    setTimeout(() => { [...caja.children].forEach((h) => { if (h !== nueva) h.remove(); }); }, 450);
  }

  function sugerencia(p, eleccion) {
    // 1) Otro sabor u opción del mismo producto que sí haya hoy
    for (const op of p.opciones) {
      for (const v of op.valores) {
        const prueba = { ...eleccion, [op.id]: v.id };
        if (v.id !== valorElegido(eleccion, op.id) && valorValido(v, prueba) && disponible(p, prueba)) {
          return { tipo: "valor", opId: op.id, valorId: v.id, texto: `Hoy sí hay ${v.nombre.toLowerCase()}. ¿Te provoca?` };
        }
      }
    }
    // 2) Un producto parecido: misma categoría y tipo, disponible y de precio cercano
    const referencia = precioBase(p, eleccion).valor || 0;
    const otro = productos
      .filter((x) => x !== p && x.tipo === p.tipo && x.categoria === p.categoria && !agotado(x) && enCarta(x))
      .sort((a, b) => Math.abs(rangoPrecios(a).min - referencia) - Math.abs(rangoPrecios(b).min - referencia))[0];
    return otro ? { tipo: "producto", id: otro.id, texto: `¿Te provoca ${otro.nombre.toLowerCase()}? Hay hoy.` } : null;
  }

  function pintarHojaProducto() {
    const p = porId.get(borrador.producto);
    const { eleccion } = borrador;
    const foto = fotoDe(p, eleccion);
    const hayHoy = disponible(p, eleccion);
    const linea = precioLinea(borrador);
    const anticipa = textoAnticipacion(p);
    const opMezcla = opcionMezcla(p);
    const mezclaIncompleta = Boolean(opMezcla && borrador.mezclaActiva === opMezcla.id && !(Array.isArray(eleccion[opMezcla.id]) && eleccion[opMezcla.id].length === 2));

    const restr = borrador.linea?.restr || null;
    const frozenA = adicionalFrozen(p);
    const frozenOn = Boolean(frozenA && borrador.adicionales.includes(frozenA.id));
    const htmlFrozen = frozenA ? `<fieldset class="opciones__grupo">
        <legend class="visualmente-oculto">Frozen</legend>
        <label class="interruptor"><input type="checkbox" data-frozen="${esc(frozenA.id)}" ${frozenOn ? "checked" : ""}><span>Frozen <small class="interruptor__precio">(+${soles(frozenA.precio.valor || 0)})</small></span></label>
      </fieldset>` : "";
    let frozenPuesto = false;
    const grupos = p.opciones.map((op) => {
      const fijada = restr && op.id === restr.opId;
      const mezclando = borrador.mezclaActiva === op.id;
      // El sabor de la línea ya está decidido: no se vuelve a preguntar…
      if (fijada && !restr.mezcla && restr.valores.length === 1) {
        // …salvo que se pueda mezclar con otro (alitas): interruptor y, al activarlo, el segundo sabor
        if (!op.mezcla) return "";
        const base = restr.valores[0];
        const elegidosM = Array.isArray(eleccion[op.id]) ? eleccion[op.id] : [eleccion[op.id]];
        const segundo = mezclando ? elegidosM[1] : null;
        const prueba = op.valores.find((v) => v.id !== base)?.id;
        const diferencia = precioBase(p, { ...eleccion, [op.id]: [base, prueba] }).valor - precioBase(p, { ...eleccion, [op.id]: base }).valor;
        const otros = op.valores.filter((v) => v.id !== base).map((v) => `<label class="pastilla">
            <input type="radio" name="op-${op.id}-segundo" value="${esc(v.id)}" data-segundo="${op.id}" ${segundo === v.id ? "checked" : ""} ${mezclando ? "" : "tabindex=\"-1\""}>
            <span>${esc(v.nombre)}</span>
          </label>`).join("");
        const total = unidadesDe(p, op, eleccion);
        return `<fieldset class="opciones__grupo mezcla${mezclando ? " mezcla--activa" : ""}">
          <legend class="visualmente-oculto">Mezclar sabores</legend>
          <label class="interruptor"><input type="checkbox" data-mezcla="${op.id}" ${mezclando ? "checked" : ""}><span>Mezclar con otro sabor (mitad y mitad)</span></label>
          ${diferencia > 0 ? `<p class="mezcla__precio">Mezclar sabores: +${soles(diferencia)}</p>` : ""}
          <div class="mezcla__despliegue" ${mezclando ? "" : "inert"}>
            <div class="mezcla__interior">
              <p class="opciones__ayuda">${segundo ? `${total / 2} de ${esc(nombreValor(p, op.id, base))} y ${total / 2} de ${esc(nombreValor(p, op.id, segundo))}.` : `Elige el segundo sabor (${total / 2} y ${total / 2}):`}</p>
              <div class="pastillas">${otros}</div>
            </div>
          </div>
        </fieldset>`;
      }
      // Con un solo valor posible no se pregunta (p. ej. jugo de mango: solo con agua)
      if (!fijada && opcionUnica(op, eleccion)) return "";
      const elegidos = Array.isArray(eleccion[op.id]) ? eleccion[op.id] : [eleccion[op.id]];
      // En eventos, las cantidades no disponibles no se muestran
      const valoresOp = (fijada ? op.valores.filter((v) => restr.valores.includes(v.id)) : op.valores)
        .filter((v) => p.tipo !== "evento" || entradaPara(p, { ...eleccion, [op.id]: v.id }).disponible);
      const pills = valoresOp.map((v) => {
        const valido = valorValido(v, eleccion);
        const sinStock = p.tipo !== "evento" && valido && !entradaPara(p, { ...eleccion, [op.id]: v.id }).disponible;
        const bloqueada = !valido || (sinStock && !paraOtroDia(p)); // “No disponible hoy” no se puede elegir
        return `<label class="pastilla${sinStock ? " pastilla--agotada" : ""}${valido ? "" : " pastilla--invalida"}">
          <input type="${mezclando ? "checkbox" : "radio"}" name="op-${op.id}" value="${esc(v.id)}" data-op="${op.id}" ${elegidos.includes(v.id) ? "checked" : ""} ${bloqueada ? "disabled" : ""}>
          <span>${esc(v.nombre)}${op.conPrecio && valido ? `<small class="pastilla__precio">${esc(textoBase(precioBase(p, { ...eleccion, [op.id]: v.id })))}</small>` : ""}${sinStock ? `<small>${textoSinStock(p, { corto: true })}</small>` : ""}</span>
        </label>`;
      }).join("");
      let mezclaHtml = "";
      if (op.mezcla) {
        const total = unidadesDe(p, op, eleccion);
        const elegidosOk = elegidos.filter(Boolean);
        const ayuda = !mezclando ? "" : elegidosOk.length === 2 ? `${total / 2} de cada sabor.`
          : fijada && restr.mezcla ? `Mitad y mitad: ${total / 2} de cada sabor.` : `Elige 2 sabores: ${total / 2} y ${total / 2}.`;
        // En la línea “mixtas” la mezcla es fija: no se muestra el interruptor
        const interruptor = fijada && restr.mezcla ? "" : `<label class="interruptor"><input type="checkbox" data-mezcla="${op.id}" ${mezclando ? "checked" : ""}><span>${esc(op.mezcla.etiqueta)}</span></label>`;
        mezclaHtml = `${interruptor}${ayuda ? `<p class="opciones__ayuda">${ayuda}</p>` : ""}`;
      }
      const titulo = fijada && restr.mezcla ? "Elige 2 sabores" : op.nombre;
      const grupo = `<fieldset class="opciones__grupo"><legend>${esc(titulo)}</legend>${mezclaHtml}<div class="pastillas">${pills}</div></fieldset>`;
      // Frozen va justo antes de helada / sin helar; al elegirlo, esa pregunta se pliega
      if (op.id === "temperatura" && frozenA) {
        frozenPuesto = true;
        return `${htmlFrozen}<div class="plegable${frozenOn ? "" : " plegable--abierto"}" data-plegable ${frozenOn ? "inert" : ""}><div class="plegable__interior">${grupo}</div></div>`;
      }
      return grupo;
    }).join("") + (frozenA && !frozenPuesto ? htmlFrozen : "");

    const max = cremas.maximoPorCrema || 2;
    const cremasHtml = p.cremas ? `<fieldset class="opciones__grupo">
        <legend>Cremas <small>Gratis · hasta ${max} de cada una</small></legend>
        <div class="cremas">${cremas.opciones.map((c) => {
          const n = borrador.cremas[c] || 0;
          return `<div class="crema${n ? " crema--elegida" : ""}">
            <span class="crema__nombre">${esc(c)}</span>
            <div class="paso paso--mini" role="group" aria-label="${esc(c)}">
              <button type="button" data-crema-paso="-1" data-crema="${esc(c)}" aria-label="Quitar ${esc(c)}" ${n <= 0 ? "disabled" : ""}>${ICONO.menos}</button>
              <output aria-live="polite" data-num="crema:${esc(c)}" data-num-valor="${n}">${n}</output>
              <button type="button" data-crema-paso="1" data-crema="${esc(c)}" aria-label="Agregar ${esc(c)}" ${n >= max ? "disabled" : ""}>${ICONO.mas}</button>
            </div>
          </div>`;
        }).join("")}</div>
      </fieldset>` : "";

    const listaAdicionales = p.adicionales.filter((id) => !adicionalPorId.get(id)?.frozen);
    const adicionalesHtml = listaAdicionales.length ? `<fieldset class="opciones__grupo">
        <legend>Agrégale</legend>
        <div class="adicionales">${listaAdicionales.map((id) => {
          const a = adicionalPorId.get(id);
          const marcada = borrador.adicionales.includes(id);
          const extra = marcada && a.pideTexto
            ? `<label class="campo adicional__texto"><span class="visualmente-oculto">${esc(a.pideTexto)}</span><input type="text" data-extra placeholder="${esc(a.pideTexto)}" value="${esc(borrador.extra)}" maxlength="80"></label>${a.nota ? `<p class="opciones__ayuda">${esc(a.nota)}</p>` : ""}`
            : "";
          return `<label class="adicional">
            <input type="checkbox" data-adicional value="${esc(id)}" ${marcada ? "checked" : ""}>
            <span class="adicional__nombre">${esc(a.nombre)}</span>
            <span class="adicional__precio">${a.precio.tipo === "fijo" ? "+ " + soles(a.precio.valor) : "precio a confirmar"}</span>
          </label>${extra}`;
        }).join("")}</div>
      </fieldset>` : "";

    let avisoHtml = "";
    if (!hayHoy) {
      const sug = sugerencia(p, eleccion);
      avisoHtml = `<div class="aviso aviso--agotado">
        ${paraOtroDia(p)
          ? "<p><strong>Hoy se acabó.</strong> Puedes pedirlo para mañana: lo marcamos “para otro día” y coordinamos la fecha por WhatsApp.</p>"
          : "<p><strong>No disponible hoy.</strong> Elige otra opción o algo más de la carta.</p>"}
        ${sug ? `<button type="button" class="enlace-flecha" data-sugerencia='${esc(JSON.stringify(sug))}'>${esc(sug.texto)} ${ICONO.flecha}</button>` : ""}
      </div>`;
    }

    const base = linea.base;
    const total = linea.valor * borrador.cantidad;
    const etiquetaPrecio = base.tipo === "cotizar" ? "a cotizar" : `${base.tipo === "desde" ? "desde " : ""}<span data-num="borrador-total" data-num-valor="${total}" data-num-formato="soles">${soles(total)}</span>${linea.pendiente && base.tipo === "fijo" ? " + extra" : ""}`;

    pintarMedia(foto, p.nombre);
    $("[data-producto-contenido]", hojaProducto).innerHTML = `
      <div class="opciones__cabeza">
        <h2 id="producto-titulo" tabindex="-1" data-foco>${esc(borrador.linea?.nombre || p.nombre)}</h2>
        ${p.descripcion ? `<p class="opciones__desc">${esc(p.descripcion)}</p>` : ""}
        ${anticipa ? `<p class="fila__estado">${esc(textoAnticipacionLargo(p))}</p>` : ""}
        ${p.soloLocal ? `<p class="opciones__local">${ETIQUETA_LOCAL} Para tomar aquí: se pide con “Reserva en el local”.</p>` : ""}
        ${borrador.editando ? `<p class="opciones__editando">Ya está ${borrador.destino === "evento" ? "en tu evento" : "en tu pedido"}${borrador.otros ? ` (tienes ${plural(borrador.otros + 1, "versión", "versiones")}; estás editando la última)` : ""}. Cambia lo que quieras y pulsa Actualizar.</p>` : ""}
      </div>
      ${avisoHtml}
      <form class="opciones" novalidate>${grupos}${cremasHtml}${adicionalesHtml}</form>`;

    const editando = Boolean(borrador.editando);
    const aEvento = borrador.destino === "evento";
    const donde = aEvento ? "de tu evento" : "del pedido";
    // Editando: el “−” se vuelve tacho en 1, y aparecen “Quitar” y “Agregar otro distinto”
    const menos = editando && borrador.cantidad <= 1
      ? `<button type="button" class="paso__tacho" data-quitar-borrador aria-label="Quitar ${donde}">${ICONO.tacho}</button>`
      : `<button type="button" data-borrador="-1" aria-label="Quitar uno" ${borrador.cantidad <= 1 ? "disabled" : ""}>${ICONO.menos}</button>`;
    const etiquetaBoton = mezclaIncompleta ? (borrador.linea?.restr && !borrador.linea.restr.mezcla ? "Elige el segundo sabor" : "Elige 2 sabores")
      : !hayHoy && !paraOtroDia(p) ? "No disponible hoy"
      : editando ? "Actualizar" : aEvento ? "Agregar a tu evento" : hayHoy ? "Agregar" : "Para otro día";
    const bloqueado = mezclaIncompleta || (!hayHoy && !paraOtroDia(p));
    $("[data-producto-pie]", hojaProducto).innerHTML = `
      ${editando ? `<div class="opciones__edicion">
        <button type="button" class="boton-quitar" data-quitar-borrador>${ICONO.tacho}<span>Quitar ${donde}</span></button>
        <button type="button" class="vaciar" data-agregar-otro>Agregar otro distinto</button>
      </div>` : ""}
      <div class="paso paso--claro" role="group" aria-label="Cantidad">
        ${menos}
        <output data-num="borrador-cantidad" data-num-valor="${borrador.cantidad}">${borrador.cantidad}</output>
        <button type="button" data-borrador="1" aria-label="Agregar uno más">${ICONO.mas}</button>
      </div>
      <button type="button" class="boton boton--tinta opciones__agregar" data-confirmar-producto ${bloqueado ? "disabled" : ""}>
        <span>${etiquetaBoton}</span>
        ${bloqueado ? "" : `<span class="opciones__total">${etiquetaPrecio}</span>`}
      </button>`;
    animarNumerosEn(hojaProducto);
  }

  function conectarHojaProducto() {
    hojaProducto.addEventListener("change", (e) => {
      if (!borrador) return;
      const p = porId.get(borrador.producto);
      const t = e.target;
      let foco = null;
      if (t.dataset.op) {
        const op = p.opciones.find((o) => o.id === t.dataset.op);
        if (t.type === "checkbox") {
          let lista = (Array.isArray(borrador.eleccion[op.id]) ? borrador.eleccion[op.id] : [borrador.eleccion[op.id]]).filter(Boolean);
          if (t.checked) { lista = [...lista.filter((v) => v !== t.value), t.value].slice(-op.mezcla.maximo); }
          else lista = lista.filter((v) => v !== t.value);
          borrador.eleccion[op.id] = lista.length ? lista : (borrador.linea?.restr?.mezcla ? [] : [op.valores[0].id]);
        } else {
          borrador.eleccion[op.id] = t.value;
        }
        // Si una opción deja de ser válida (p. ej. “con leche” en piña), pasa a la primera válida.
        p.opciones.forEach((o) => {
          const actual = o.valores.find((v) => v.id === valorElegido(borrador.eleccion, o.id));
          if (actual && !valorValido(actual, borrador.eleccion)) borrador.eleccion[o.id] = o.valores.find((v) => valorValido(v, borrador.eleccion))?.id;
        });
        foco = `[data-op="${op.id}"][value="${t.value}"]`;
      } else if (t.dataset.mezcla) {
        const opId = t.dataset.mezcla;
        borrador.mezclaActiva = t.checked ? opId : null;
        borrador.eleccion[opId] = t.checked ? [valorElegido(borrador.eleccion, opId)] : valorElegido(borrador.eleccion, opId);
        borrador.animarMezcla = true; // el despliegue de sabores se anima solo al tocar el interruptor
        foco = `[data-mezcla="${opId}"]`;
      } else if (t.dataset.segundo) {
        // Segundo sabor de la mezcla: el primero es el de la línea
        const opId = t.dataset.segundo;
        borrador.eleccion[opId] = [valorElegido(borrador.eleccion, opId), t.value];
        foco = `[data-segundo="${opId}"][value="${t.value}"]`;
      } else if (t.dataset.frozen) {
        // Frozen: no lleva helada / sin helar; al quitarlo vuelve la primera opción
        const id = t.dataset.frozen;
        borrador.adicionales = t.checked ? [...borrador.adicionales.filter((a) => a !== id), id] : borrador.adicionales.filter((a) => a !== id);
        const temp = p.opciones.find((o) => o.id === "temperatura");
        if (temp && !t.checked && !borrador.eleccion.temperatura) borrador.eleccion.temperatura = temp.valores[0].id;
        borrador.animarPlegable = true;
        foco = `[data-frozen="${id}"]`;
      } else if (t.hasAttribute("data-adicional")) {
        borrador.adicionales = t.checked ? [...borrador.adicionales, t.value] : borrador.adicionales.filter((a) => a !== t.value);
        if (!t.checked && adicionalPorId.get(t.value)?.pideTexto) borrador.extra = "";
        foco = `[data-adicional][value="${t.value}"]`;
      } else {
        return;
      }
      pintarHojaProducto();
      if (borrador.animarMezcla) {
        // Se dibuja en el estado anterior y se cambia en el siguiente cuadro, así el despliegue se anima
        const m = hojaProducto.querySelector(".mezcla");
        if (m) {
          const activa = m.classList.contains("mezcla--activa");
          m.classList.toggle("mezcla--activa", !activa);
          void m.offsetHeight;
          requestAnimationFrame(() => m.classList.toggle("mezcla--activa", activa));
        }
        borrador.animarMezcla = false;
      }
      if (borrador.animarPlegable) {
        const pl = hojaProducto.querySelector("[data-plegable]");
        if (pl) {
          const abierto = pl.classList.contains("plegable--abierto");
          pl.classList.toggle("plegable--abierto", !abierto);
          void pl.offsetHeight;
          requestAnimationFrame(() => pl.classList.toggle("plegable--abierto", abierto));
        }
        borrador.animarPlegable = false;
      }
      const nuevo = foco && hojaProducto.querySelector(foco);
      if (nuevo) nuevo.focus({ preventScroll: true });
    });
    hojaProducto.addEventListener("input", (e) => {
      if (e.target.hasAttribute("data-extra") && borrador) borrador.extra = e.target.value;
    });
    hojaProducto.addEventListener("click", (e) => {
      if (!borrador) return;
      const paso = e.target.closest("[data-borrador]");
      if (paso) {
        borrador.cantidad = Math.max(1, borrador.cantidad + Number(paso.dataset.borrador));
        pintarHojaProducto();
        return;
      }
      const crema = e.target.closest("[data-crema-paso]");
      if (crema) {
        const nombre = crema.dataset.crema;
        const dir = Number(crema.dataset.cremaPaso);
        const max = cremas.maximoPorCrema || 2;
        const n = Math.min(max, Math.max(0, (borrador.cremas[nombre] || 0) + dir));
        if (n) borrador.cremas[nombre] = n; else delete borrador.cremas[nombre];
        pintarHojaProducto();
        // Mantener el foco en el mismo botón (o en el otro si este quedó deshabilitado)
        const mismo = hojaProducto.querySelector(`[data-crema="${CSS.escape(nombre)}"][data-crema-paso="${dir}"]`);
        const otro = hojaProducto.querySelector(`[data-crema="${CSS.escape(nombre)}"][data-crema-paso="${-dir}"]`);
        (mismo && !mismo.disabled ? mismo : otro)?.focus({ preventScroll: true });
        return;
      }
      const sug = e.target.closest("[data-sugerencia]");
      if (sug) {
        const s = JSON.parse(sug.dataset.sugerencia);
        if (s.tipo === "valor") {
          const p = porId.get(borrador.producto);
          const r = borrador.linea?.restr;
          if (r && s.opId === r.opId && !r.valores.includes(s.valorId)) {
            // El sabor sugerido es otra línea de la carta: se abre esa línea
            cerrarDialogo(hojaProducto, () => abrirProducto(p.id, { ...borrador.eleccion, [s.opId]: s.valorId }));
            return;
          }
          borrador.eleccion[s.opId] = s.valorId;
          borrador.mezclaActiva = null;
          pintarHojaProducto();
        } else {
          cerrarDialogo(hojaProducto, () => abrirProducto(s.id));
        }
        return;
      }
      if (e.target.closest("[data-quitar-borrador]")) {
        const { destino, editando } = borrador;
        if (editando) cerrarDialogo(hojaProducto, () => quitarLinea(destino, editando));
        return;
      }
      if (e.target.closest("[data-agregar-otro]")) {
        const { producto, linea, destino } = borrador;
        abrirProducto(producto, undefined, linea.clave, { destino, nuevo: true });
        $("[data-foco]", hojaProducto)?.focus({ preventScroll: true });
        return;
      }
      if (e.target.closest("[data-confirmar-producto]")) {
        const p = porId.get(borrador.producto);
        const op = opcionMezcla(p);
        const eleccion = { ...borrador.eleccion };
        if (op && Array.isArray(eleccion[op.id]) && eleccion[op.id].length < 2) eleccion[op.id] = eleccion[op.id][0];
        if (borrador.adicionales.some((id) => adicionalPorId.get(id)?.frozen)) delete eleccion.temperatura;
        const { destino, editando } = borrador;
        if (destino !== "evento" && !disponible(p, eleccion) && !paraOtroDia(p)) return; // no disponible hoy
        const nueva = {
          producto: p.id,
          eleccion,
          cremas: Object.fromEntries(cremasLista(borrador.cremas)),
          adicionales: [...borrador.adicionales],
          extra: borrador.adicionales.some((id) => adicionalPorId.get(id)?.pideTexto) ? borrador.extra.trim() : "",
          cantidad: borrador.cantidad,
          otroDia: destino === "evento" ? false : !disponible(p, eleccion),
        };
        cerrarDialogo(hojaProducto, () => {
          if (editando) reemplazarLinea(destino, editando, nueva);
          else if (destino === "evento") agregarEvento(nueva);
          else agregarLinea(nueva);
        });
      }
    });
  }

  /* ---------- diálogos ---------- */
  /* Movimiento de los diálogos.
     Causa del “abre brusco”: al abrir, el navegador enfocaba el título (autofocus) y desplazaba el
     diálogo para mostrarlo, así el panel aparecía ya en su sitio y la transición corría sin verse.
     Ahora el diálogo no puede desplazarse (overflow: clip en CSS) y el foco se pone con preventScroll. */
  const DURACION_CIERRE = 260;
  function abrirDialogo(d) {
    if (d.open) return;
    d.classList.remove("abierto");
    d.showModal();
    d.scrollTop = 0;
    d.scrollLeft = 0;
    void d.offsetWidth; // fija el estado inicial (fuera de pantalla) antes de animar
    requestAnimationFrame(() => {
      d.classList.add("abierto");
      const foco = d.querySelector("[data-foco]") || d.querySelector("h2");
      if (foco) foco.focus({ preventScroll: true });
    });
    actualizarBarra();
  }
  function cerrarDialogo(d, despues) {
    if (!d.open) { if (despues) despues(); return; }
    d.classList.remove("abierto");
    let hecho = false;
    const terminar = () => {
      if (hecho) return;
      hecho = true;
      d.close();
      actualizarBarra();
      if (despues) despues();
    };
    const panel = d.firstElementChild;
    panel.addEventListener("transitionend", (e) => { if (e.target === panel && e.propertyName !== "box-shadow") terminar(); }, { once: true });
    setTimeout(terminar, DURACION_CIERRE + 40);
  }
  function conectarDialogo(d) {
    d.addEventListener("click", (e) => { if (e.target === d) cerrarDialogo(d); });
    d.addEventListener("cancel", (e) => { e.preventDefault(); cerrarDialogo(d); });
    $$("[data-cerrar]", d).forEach((b) => b.addEventListener("click", () => cerrarDialogo(d)));
  }

  /* ---------- Deslizar hacia abajo para cerrar (solo celular) ----------
     Mientras el dedo está abajo, la hoja ES el dedo: se mueve 1:1, sin transición, y el fondo se aclara
     al mismo ritmo. Al soltar: se cierra si bajó más de un tercio o si iba rápido (un “flick”); si no,
     vuelve a su sitio con la curva de entrada de siempre. Dentro de la lista solo arrastra cuando ya está
     arriba del todo, para no pelear con el scroll. Los campos de texto nunca empiezan un arrastre. */
  const esCelular = () => matchMedia("(max-width: 51.99rem)").matches;
  function deslizarParaCerrar({ hoja, abierta, desplazable, fondo, cerrar }) {
    const IMP = "important";
    let g = null;
    let ignorarClicHasta = 0;
    const limpiar = () => {
      hoja.style.removeProperty("transform");
      hoja.style.removeProperty("transition");
      fondo.limpiar();
    };
    hoja.addEventListener("touchstart", (e) => {
      g = null;
      if (!esCelular() || !abierta() || e.touches.length > 1) return;
      // Los campos y la rueda de la hora (que se desliza en vertical) nunca empiezan un arrastre
      if (e.target.closest("input:not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable], [data-sin-arrastre]")) return;
      const t = e.touches[0];
      const caja = desplazable();
      g = { x0: t.clientX, y0: t.clientY, caja: caja && caja.contains(e.target) ? caja : null, estado: "espera", y: 0, base: 0, alto: 1, muestras: [] };
    }, { passive: true });
    hoja.addEventListener("touchmove", (e) => {
      if (!g || g.estado === "no") return;
      if (e.touches.length > 1) { if (g.estado === "arrastra") soltar(); g = null; return; } // un segundo dedo no hace saltar la hoja
      const t = e.touches[0];
      const dx = t.clientX - g.x0;
      const dy = t.clientY - g.y0;
      if (g.estado === "espera") {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        const haciaAbajo = dy > 0 && Math.abs(dy) > Math.abs(dx);
        const enLaCima = !g.caja || g.caja.scrollTop <= 0;
        if (!haciaAbajo || !enLaCima || !e.cancelable) { g.estado = "no"; return; }
        g.estado = "arrastra";
        g.base = dy; // empieza desde donde está el dedo, sin salto
        g.alto = hoja.offsetHeight || 1;
        hoja.style.setProperty("transition", "none", IMP);
        fondo.sinTransicion();
      }
      e.preventDefault();
      let y = dy - g.base;
      if (y < 0) y = -Math.min(24, Math.sqrt(-y) * 2); // hacia arriba: resistencia, no pared
      g.y = y;
      g.muestras.push({ y, t: e.timeStamp });
      while (g.muestras.length > 2 && e.timeStamp - g.muestras[0].t > 100) g.muestras.shift();
      hoja.style.setProperty("transform", `translateY(${y}px)`, IMP);
      fondo.progreso(1 - Math.max(0, y) / g.alto);
    }, { passive: false });
    function soltar() {
      const m = g.muestras;
      const a = m[0];
      const b = m[m.length - 1];
      const velocidad = a && b && b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0; // px por ms
      const cierra = g.y > g.alto / 3 || (velocidad > 0.45 && g.y > 16);
      ignorarClicHasta = Date.now() + 400; // el dedo que suelta no “toca” lo que quedó debajo
      if (!cierra) { limpiar(); return; } // vuelve con la transición de entrada de la hoja
      const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reducido) {
        hoja.style.setProperty("transition", "opacity 180ms ease", IMP); // se desvanece donde quedó
      } else {
        // Sale a la velocidad del dedo: curva que arranca rápido (la de las hojas), no la de cierre por botón
        hoja.style.setProperty("transition", "transform 280ms cubic-bezier(0.32, 0.72, 0, 1)", IMP);
        hoja.style.removeProperty("transform");
      }
      fondo.limpiar();
      cerrar();
      setTimeout(() => { if (!abierta()) limpiar(); }, 420);
    }
    const fin = () => { if (g && g.estado === "arrastra") soltar(); g = null; };
    hoja.addEventListener("touchend", fin);
    hoja.addEventListener("touchcancel", fin);
    hoja.addEventListener("click", (e) => {
      if (Date.now() < ignorarClicHasta) { e.preventDefault(); e.stopPropagation(); }
    }, true);
  }
  function fondoDeDialogo(d) {
    return {
      sinTransicion: () => d.style.setProperty("transition", "none", "important"),
      progreso: (p) => d.style.setProperty("background-color", `rgb(23 18 15 / ${(0.5 * p).toFixed(3)})`, "important"),
      limpiar: () => { d.style.removeProperty("transition"); d.style.removeProperty("background-color"); },
    };
  }
  function conectarDeslizar() {
    [hojaPedido, hojaProducto].forEach((d) => {
      deslizarParaCerrar({
        hoja: $(".pedido__hoja", d),
        abierta: () => d.open && d.classList.contains("abierto"),
        desplazable: () => $(".pedido__cuerpo", d),
        fondo: fondoDeDialogo(d),
        cerrar: () => cerrarDialogo(d),
      });
    });
  }

  /* ---------- hoja de pedido ---------- */
  const hojaPedido = $("[data-pedido]");
  const gracias = $("[data-gracias]");

  function htmlLinea(l) {
    const clave = claveLinea(l);
    const d = desglose(l);
    return `<li class="linea">
      <div class="linea__texto">
        <p class="linea__titulo"><span>${l.cantidad} x ${esc(d.nombre)}</span><span class="linea__monto">${d.precio}</span></p>
        ${d.cremas ? `<p class="linea__detalle">${esc(d.cremas)}</p>` : ""}
        ${d.extras.map((x) => `<p class="linea__extra"><span>${esc(x.texto)}</span><span class="linea__monto">${x.precio}</span></p>`).join("")}
        ${d.total ? `<p class="linea__total${d.suma ? "" : " linea__total--cotiza"}">${esc(d.total)}</p>` : ""}
        ${d.aviso ? `<p class="linea__aviso">${esc(d.aviso)}</p>` : ""}
      </div>
      <div class="paso paso--claro" role="group" aria-label="Cantidad de ${esc(d.p.nombre)}">
        ${l.cantidad <= 1
          ? `<button type="button" class="paso__tacho" data-linea-restar="${esc(clave)}" data-quitar-linea aria-label="Quitar del pedido" title="Quitar del pedido">${ICONO.tacho}</button>`
          : `<button type="button" data-linea-restar="${esc(clave)}" aria-label="Quitar uno">${ICONO.menos}</button>`}
        <output data-num="linea:${esc(clave)}" data-num-valor="${l.cantidad}">${l.cantidad}</output>
        <button type="button" data-linea-sumar="${esc(clave)}" aria-label="Agregar uno más">${ICONO.mas}</button>
      </div>
    </li>`;
  }
  /* Debajo del subtotal solo se aclara el delivery: lo a cotizar ya lo dice cada línea */
  /* ---------- modalidades: delivery, recojo y reserva ---------- */
  const MOD = { delivery: "Delivery", recojo: "Recojo en el local", reserva: "Reserva en el local" };
  let horario = { dia: null, hora: null }; // día ("AAAA-MM-DD") y hora (minutos) elegidos para recojo, reserva o entrega
  function formPedido() { return $("[data-form-pedido]"); }
  function modalidad() { return formPedido().modalidad.value; }
  /* Días de anticipación que exige el pedido: por encargo según el producto; “para otro día”, desde mañana */
  function diasMinimos() {
    return lineasValidas().reduce((dias, l) => {
      const p = porId.get(l.producto);
      if (p.tipo === "encargo") dias = Math.max(dias, p.anticipacion || 0);
      if (l.otroDia) dias = Math.max(dias, 1);
      return dias;
    }, 0);
  }
  /* ¿Hay que elegir día y hora? En recojo y reserva, siempre; en delivery, solo si hay algo por encargo o para otro día */
  function pideHorario(m = modalidad()) {
    return m !== MOD.delivery || diasMinimos() > 0;
  }
  function ultimaHora(m = modalidad()) {
    return minutosDe(m === MOD.reserva ? REGLAS.ultimaHoraReserva : REGLAS.ultimaHoraRecojo);
  }
  /* Primera hora posible de un día: no antes de abrir ni a menos del tiempo mínimo de preparación */
  function primeraHora(iso) {
    const a = limaAhora();
    let desde = APERTURA;
    if (iso === a.iso) desde = Math.max(desde, Math.ceil((a.min + REGLAS.minutosMinimos) / 15) * 15);
    return desde;
  }
  /* Días que se pueden elegir en el calendario: desde el primero que permite la anticipación del pedido
     y hasta 30 días después; de martes a domingo y solo si todavía queda alguna hora ese día. */
  const DIAS_CALENDARIO = 30;
  function primerDia() { return sumarDias(limaAhora().iso, diasMinimos()); }
  function ultimoDia() { return sumarDias(primerDia(), DIAS_CALENDARIO); }
  function diaPosible(iso, m = modalidad()) {
    return iso >= primerDia() && iso <= ultimoDia() && abreElDia(iso) && primeraHora(iso) <= ultimaHora(m);
  }
  function primerDiaPosible(m = modalidad()) {
    for (let iso = primerDia(), fin = ultimoDia(); iso <= fin; iso = sumarDias(iso, 1)) if (diaPosible(iso, m)) return iso;
    return null;
  }
  /* Horas de atención de un día, cada 15 minutos (en minutos desde la medianoche) */
  function horasDelDia(iso, m = modalidad()) {
    const lista = [];
    for (let min = primeraHora(iso); min <= ultimaHora(m); min += 15) lista.push(min);
    return lista;
  }
  /* “Hoy, viernes 6 de noviembre, 8 pm” */
  function textoMomento(iso, min) {
    const fecha = new Intl.DateTimeFormat("es-PE", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(iso + "T12:00:00Z"));
    const dia = textoDia(iso);
    const inicio = ["Hoy", "Mañana"].includes(dia) ? `${dia}, ${fecha}` : fecha.charAt(0).toUpperCase() + fecha.slice(1);
    return `${inicio}, ${textoHora(min)}`;
  }
  function fechaLarga(iso) {
    return new Intl.DateTimeFormat("es-PE", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(iso + "T12:00:00Z")).replace(",", "");
  }

  /* ---------- Día y hora: calendario + rueda ----------
     El calendario es el mismo de Eventos, dentro de la hoja. Al elegir el día se despliega (.plegable)
     una rueda de hora y minutos, como la alarma del celular: lo que queda en la banda del centro es lo
     elegido. La rueda arranca en la primera hora posible y solo muestra las horas de atención de ese día. */
  const MINUTOS = [0, 15, 30, 45];
  let mesHorario = null; // primer día del mes que muestra el calendario ("AAAA-MM-01")
  function armarHorario(caja) {
    const flecha = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d < 0 ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"}"/></svg>`;
    caja.innerHTML = `
      <p class="horario__titulo" id="horario-titulo" data-horario-titulo></p>
      <div class="horario__nota" data-horario-nota></div>
      <p class="horario__resumen" data-horario-resumen></p>
      <div class="calendario calendario--fijo" role="group" aria-labelledby="horario-titulo">
        <div class="calendario__cabeza">
          <button type="button" class="calendario__mes" data-mes-pedido="-1" aria-label="Mes anterior">${flecha(-1)}</button>
          <p class="calendario__titulo" data-horario-mes aria-live="polite"></p>
          <button type="button" class="calendario__mes" data-mes-pedido="1" aria-label="Mes siguiente">${flecha(1)}</button>
        </div>
        <div class="calendario__semana" aria-hidden="true"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
        <div class="calendario__dias" data-horario-dias></div>
        <p class="calendario__pie" data-horario-pie></p>
      </div>
      <div class="plegable horario__pliegue" data-horario-pliegue inert>
        <div class="plegable__interior">
          <p class="horario__titulo">Hora</p>
          <div class="rueda-hora" data-rueda data-sin-arrastre>
            <div class="rueda-hora__banda" aria-hidden="true"></div>
            <div class="rueda-hora__col" data-rueda-col="h" tabindex="0" role="spinbutton" aria-label="Hora"><ul aria-hidden="true"></ul></div>
            <span class="rueda-hora__sep" aria-hidden="true">:</span>
            <div class="rueda-hora__col" data-rueda-col="m" tabindex="0" role="spinbutton" aria-label="Minutos"><ul aria-hidden="true">${MINUTOS.map((m) => `<li data-v="${m}">${String(m).padStart(2, "0")}</li>`).join("")}</ul></div>
            <span class="rueda-hora__ampm" aria-hidden="true" data-rueda-ampm>pm</span>
          </div>
          <p class="rueda-hora__nota" data-rueda-nota></p>
        </div>
      </div>
      <small class="campo__error" data-error="horario"></small>`;
    caja.dataset.listo = "1";
    conectarRueda(caja);
  }
  function pintarHorario() {
    const caja = $("[data-horario]");
    const m = modalidad();
    caja.hidden = !pideHorario(m);
    if (caja.hidden) return;
    if (!caja.dataset.listo) armarHorario(caja);
    // Lo elegido tiene que seguir siendo posible (el reloj avanza y la modalidad cambia el cierre)
    if (horario.dia && !diaPosible(horario.dia, m)) horario = { dia: null, hora: null };
    const horas = horario.dia ? horasDelDia(horario.dia, m) : [];
    if (horario.dia && !horas.includes(horario.hora)) {
      // Sin hora, la primera; si la elegida ya no vale, la más cercana
      horario.hora = horario.hora === null ? horas[0]
        : horas.reduce((a, b) => (Math.abs(b - horario.hora) < Math.abs(a - horario.hora) ? b : a), horas[0]);
    }
    $("[data-horario-titulo]", caja).textContent = m === MOD.reserva ? "Día y hora de tu reserva" : m === MOD.recojo ? "¿Cuándo lo recoges?" : "¿Cuándo te lo llevamos?";

    const dm = diasMinimos();
    const notaBoxes = fechaPorConfirmar() ? ` Si el modelo de tus boxes es elaborado, puede tomar hasta ${Math.max(...lineasValidas().map((l) => porId.get(l.producto).anticipacionMax || 0))} días: te confirmamos la fecha por WhatsApp.` : "";
    // Si solo los boxes ponen la anticipación, se muestra su texto tal cual
    const soloBoxes = fechaPorConfirmar() && lineasValidas().every((l) => { const p = porId.get(l.producto); return p.tipo !== "encargo" || p.anticipacionMax > p.anticipacion; });
    // Productos del día junto con algo por encargo: todo sale el día elegido, y se avisa claro
    const delDia = dm > 1 && lineasValidas().some((l) => !l.otroDia && porId.get(l.producto).tipo !== "encargo");
    const avisoEncargo = delDia && horario.dia ? `Tu pedido incluye productos por encargo, así que todo se entrega el ${fechaLarga(horario.dia)}${notaBoxes ? " (fecha sujeta a confirmación)" : ""}. Si quieres algo para hoy, haz un pedido aparte.${notaBoxes}` : "";
    const nota = avisoEncargo ? `<p class="aviso aviso--encargo" data-aviso-encargo>${esc(avisoEncargo)}</p>`
      : soloBoxes ? `<p class="pedido__ayuda">${esc(textoAnticipacionLargo(lineasValidas().map((l) => porId.get(l.producto)).find((p) => p.anticipacionMax > p.anticipacion)))}</p>`
      : notaBoxes ? `<p class="pedido__ayuda">${esc(notaBoxes.trim())}</p>` : "";
    const cajaNota = $("[data-horario-nota]", caja);
    if (cajaNota.innerHTML !== nota) cajaNota.innerHTML = nota;
    cajaNota.hidden = !nota;

    const resumen = $("[data-horario-resumen]", caja);
    if (horario.dia) {
      const dia = textoDia(horario.dia);
      const cuando = dia === "Hoy" ? `hoy, ${fechaLarga(horario.dia)}` : dia === "Mañana" ? `mañana, ${fechaLarga(horario.dia)}` : `el ${fechaLarga(horario.dia)}`;
      const verbo = m === MOD.reserva ? "Te esperamos" : m === MOD.recojo ? "Recoges" : "Te lo llevamos";
      resumen.innerHTML = `${verbo} <strong>${esc(cuando)}</strong>, a las <strong>${esc(textoHora(horario.hora))}</strong>.`;
      resumen.classList.remove("horario__resumen--vacio");
    } else {
      resumen.textContent = primerDiaPosible(m) ? "Elige el día en el calendario." : "No hay días disponibles para este pedido. Escríbenos por WhatsApp.";
      resumen.classList.add("horario__resumen--vacio");
    }
    $("[data-horario-pie]", caja).textContent = dm > 1 ? `Tu pedido tiene productos por encargo: puedes elegir desde el ${fechaLarga(primerDia())}.`
      : dm === 1 ? "Tu pedido tiene productos para otro día: puedes elegir desde mañana."
      : `Atendemos de martes a domingo, de ${textoHora(APERTURA)} a ${textoHora(CIERRE)}.`;
    pintarCalendarioPedido(caja, m);

    const pliegue = $("[data-horario-pliegue]", caja);
    pliegue.classList.toggle("plegable--abierto", Boolean(horario.dia));
    pliegue.inert = !horario.dia;
    if (horario.dia) pintarRueda(caja, horas);
  }
  function pintarCalendarioPedido(caja, m) {
    const desde = primerDia();
    const hasta = ultimoDia();
    const hoy = limaAhora().iso;
    const mesDe = (iso) => iso.slice(0, 8) + "01";
    if (!mesHorario) mesHorario = mesDe(horario.dia || primerDiaPosible(m) || desde);
    if (mesHorario < mesDe(desde)) mesHorario = mesDe(desde);
    if (mesHorario > mesDe(hasta)) mesHorario = mesDe(hasta);
    const v = new Date(mesHorario + "T12:00:00Z");
    const nombre = new Intl.DateTimeFormat("es-PE", { timeZone: "UTC", month: "long", year: "numeric" }).format(v);
    const titulo = $("[data-horario-mes]", caja);
    const textoMes = nombre.charAt(0).toUpperCase() + nombre.slice(1);
    if (titulo.textContent !== textoMes) titulo.textContent = textoMes;
    $('[data-mes-pedido="-1"]', caja).disabled = mesHorario <= mesDe(desde);
    $('[data-mes-pedido="1"]', caja).disabled = mesHorario >= mesDe(hasta);
    const rejilla = $("[data-horario-dias]", caja);
    const enfocado = rejilla.contains(document.activeElement) ? document.activeElement.dataset.diaPedido : null;
    const inicio = (v.getUTCDay() + 6) % 7; // lunes primero
    const total = new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth() + 1, 0)).getUTCDate();
    let html = "";
    for (let i = 0; i < inicio; i++) html += '<span class="calendario__vacio" aria-hidden="true"></span>';
    for (let d = 1; d <= total; d++) {
      const iso = mesHorario.slice(0, 8) + String(d).padStart(2, "0");
      const ok = diaPosible(iso, m);
      const sel = iso === horario.dia;
      html += `<button type="button" class="calendario__dia${iso === hoy ? " calendario__dia--hoy" : ""}" data-dia-pedido="${iso}" aria-pressed="${sel}" aria-label="${esc(fechaLarga(iso))}${ok ? "" : ", no disponible"}"${ok ? "" : " disabled"} tabindex="-1">${d}</button>`;
    }
    if (rejilla.innerHTML !== html) rejilla.innerHTML = html;
    // Un solo día enfocable con Tab (el elegido o el primero posible); las flechas mueven entre días
    const activos = $$(".calendario__dia:not([disabled])", rejilla);
    activos.forEach((b) => { b.tabIndex = -1; });
    const foco = activos.find((b) => b.dataset.diaPedido === (enfocado || horario.dia)) || activos[0];
    if (foco) foco.tabIndex = 0;
    if (enfocado && foco && document.activeElement !== foco) foco.focus({ preventScroll: true });
  }

  /* La rueda: cada columna se desplaza con imán (scroll-snap) y lo que queda en la banda es lo elegido.
     Al desplazar, cada número se inclina y se apaga según su distancia a la banda (solo transform y
     opacity, en un cuadro por evento). Los minutos que no se pueden quedan apagados; si la rueda se
     detiene en uno, salta al más cercano. */
  function ruedaPartes(caja = $("[data-horario]")) {
    return { rueda: $("[data-rueda]", caja), colH: $('[data-rueda-col="h"]', caja), colM: $('[data-rueda-col="m"]', caja) };
  }
  const altoFila = (col) => col.querySelector("li")?.offsetHeight || 0;
  function inclinar(col) {
    const alto = altoFila(col);
    if (!alto) return;
    const centro = col.scrollTop / alto;
    $$("li", col).forEach((li, i) => {
      const d = i - centro;
      const a = Math.min(Math.abs(d), 2.5);
      li.style.transform = `rotateX(${(-d * 20).toFixed(1)}deg) scale(${(1 - a * 0.06).toFixed(3)})`;
      li.style.opacity = (1 - a * 0.3).toFixed(3);
    });
  }
  function irA(col, i, suave) {
    const alto = altoFila(col);
    if (!alto) return;
    if (Math.abs(col.scrollTop - i * alto) < 1) return; // ya está ahí: no hay desplazamiento que esperar
    if (suave && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      col.dataset.moviendo = "1";
      // Si el navegador no avisa el final del desplazamiento, se libera igual
      clearTimeout(col._liberar);
      col._liberar = setTimeout(() => { delete col.dataset.moviendo; }, 900);
      col.scrollTo({ top: i * alto, behavior: "smooth" });
    } else {
      col.scrollTop = i * alto;
      inclinar(col);
    }
  }
  function pintarRueda(caja, horas) {
    const { colH, colM } = ruedaPartes(caja);
    const hs = [...new Set(horas.map((x) => Math.floor(x / 60)))];
    const clave = hs.join(",");
    if (colH.dataset.clave !== clave) {
      $("ul", colH).innerHTML = hs.map((h) => `<li data-v="${h}">${h % 12 || 12}</li>`).join("");
      colH.dataset.clave = clave;
    }
    const h = Math.floor(horario.hora / 60);
    const mm = horario.hora % 60;
    $$("li", colM).forEach((li) => li.classList.toggle("rueda-hora__no", !horas.includes(h * 60 + Number(li.dataset.v))));
    colH.setAttribute("aria-valuetext", `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`);
    colH.setAttribute("aria-valuenow", String(h));
    colM.setAttribute("aria-valuetext", `${mm} minutos`);
    colM.setAttribute("aria-valuenow", String(mm));
    $("[data-rueda-ampm]", caja).textContent = h < 12 ? "am" : "pm";
    $("[data-rueda-nota]", caja).textContent = horario.dia === limaAhora().iso
      ? `Hoy, desde las ${textoHora(horas[0])}: necesitamos ${REGLAS.minutosMinimos} minutos para prepararlo.`
      : `De ${textoHora(horas[0])} a ${textoHora(horas[horas.length - 1])}.`;
    sincronizarRueda(caja);
  }
  // Lleva cada columna a lo elegido, sin animación, salvo que el cliente la esté moviendo
  function sincronizarRueda(caja = $("[data-horario]")) {
    if (!horario.dia || horario.hora === null) return;
    const { colH, colM } = ruedaPartes(caja);
    const hs = $$("li", colH).map((li) => Number(li.dataset.v));
    [[colH, hs.indexOf(Math.floor(horario.hora / 60))], [colM, MINUTOS.indexOf(horario.hora % 60)]].forEach(([col, i]) => {
      const alto = altoFila(col);
      if (!alto || col.dataset.moviendo) return;
      if (Math.round(col.scrollTop / alto) !== i || Math.abs(col.scrollTop - i * alto) > 1) col.scrollTop = i * alto;
      inclinar(col);
    });
  }
  // Cuando la rueda se detiene: se lee lo que quedó en la banda
  function asentar(col) {
    const caja = $("[data-horario]");
    const { colH, colM } = ruedaPartes(caja);
    if (!horario.dia || horario.hora === null) return;
    const horas = horasDelDia(horario.dia);
    const items = $$("li", col);
    const i = Math.max(0, Math.min(items.length - 1, Math.round(col.scrollTop / (altoFila(col) || 1))));
    let h = Math.floor(horario.hora / 60);
    let mm = horario.hora % 60;
    if (col === colH) h = Number(items[i].dataset.v); else mm = Number(items[i].dataset.v);
    let elegida = h * 60 + mm;
    if (!horas.includes(elegida)) {
      const deLaHora = horas.filter((x) => Math.floor(x / 60) === h);
      elegida = deLaHora.reduce((a, b) => (Math.abs(b - elegida) < Math.abs(a - elegida) ? b : a), deLaHora[0]);
    }
    if (MINUTOS.indexOf(elegida % 60) !== Math.round(colM.scrollTop / (altoFila(colM) || 1))) irA(colM, MINUTOS.indexOf(elegida % 60), true);
    if (elegida === horario.hora) return;
    horario.hora = elegida;
    pintarTotales(); // la hora cambia la promo 2x1 y el resumen
  }
  function conectarRueda(caja) {
    const { rueda, colH, colM } = ruedaPartes(caja);
    [colH, colM].forEach((col) => {
      let cuadro = 0;
      let espera = 0;
      const detenida = () => { clearTimeout(espera); delete col.dataset.moviendo; asentar(col); };
      col.addEventListener("scroll", () => {
        col.dataset.moviendo = "1";
        cancelAnimationFrame(cuadro);
        cuadro = requestAnimationFrame(() => inclinar(col));
        clearTimeout(espera);
        espera = setTimeout(detenida, 160);
      }, { passive: true });
      col.addEventListener("scrollend", detenida);
      col.addEventListener("click", (e) => {
        const li = e.target.closest("li");
        if (li) irA(col, $$("li", col).indexOf(li), true);
      });
      col.addEventListener("keydown", (e) => {
        const n = $$("li", col).length;
        const actual = Math.round(col.scrollTop / (altoFila(col) || 1));
        // Como un selector de números: flecha arriba sube el valor
        const destino = { ArrowUp: actual + 1, ArrowDown: actual - 1, PageUp: actual + 2, PageDown: actual - 2, Home: 0, End: n - 1 }[e.key];
        if (destino === undefined) return;
        e.preventDefault();
        irA(col, Math.max(0, Math.min(n - 1, destino)), false); // con teclado, sin animación
        asentar(col);
      });
    });
    // Mientras la hoja está cerrada la rueda no mide nada: al verse, se coloca en lo elegido
    if ("ResizeObserver" in window) new ResizeObserver(() => sincronizarRueda(caja)).observe(rueda);
  }
  function moverMesHorario(paso) {
    const v = new Date(mesHorario + "T12:00:00Z");
    v.setUTCMonth(v.getUTCMonth() + paso, 1);
    mesHorario = v.toISOString().slice(0, 10);
    pintarHorario();
  }
  // Flechas en el calendario: de día en día o de semana en semana, saltando los que no se pueden
  function teclaCalendarioPedido(e) {
    const b = e.target.closest("[data-dia-pedido]");
    const paso = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!b || !paso) return;
    e.preventDefault();
    let iso = b.dataset.diaPedido;
    for (let i = 0; i < 6; i++) {
      iso = sumarDias(iso, paso);
      if (iso < primerDia() || iso > ultimoDia()) return;
      if (diaPosible(iso)) break;
    }
    if (!diaPosible(iso)) return;
    if (iso.slice(0, 8) + "01" !== mesHorario) { mesHorario = iso.slice(0, 8) + "01"; pintarHorario(); }
    const caja = $("[data-horario]");
    const nuevo = $(`[data-dia-pedido="${iso}"]`, caja);
    if (nuevo) { $$("[data-dia-pedido]", caja).forEach((x) => { x.tabIndex = -1; }); nuevo.tabIndex = 0; nuevo.focus({ preventScroll: true }); }
  }
  function elegirDiaPedido(iso) {
    const abrir = !horario.dia;
    horario = { dia: iso, hora: horario.hora }; // la hora elegida se mantiene si ese día también se puede (si no, la más cercana)
    pintarTotales();
    $(`[data-dia-pedido="${iso}"]`)?.focus({ preventScroll: true });
    anunciar(`Elegiste ${textoMomento(horario.dia, horario.hora)}. Puedes cambiar la hora en la rueda.`);
    // Si la rueda se acaba de desplegar fuera de la vista, la hoja baja lo justo para mostrarla
    if (abrir) {
      setTimeout(() => {
        const rueda = $("[data-rueda]");
        const cuerpo = rueda?.closest(".pedido__cuerpo");
        if (!cuerpo) return;
        const falta = rueda.getBoundingClientRect().bottom + 16 - cuerpo.getBoundingClientRect().bottom;
        if (falta > 0) cuerpo.scrollBy({ top: falta, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      }, 420);
    }
  }

  /* ---------- promo 2x1 en tragos ---------- */
  function esCategoriaPromo(c) { return Boolean(c && c.nombre) && normal(c.nombre) === normal(PROMO.categoria); }
  function enHorarioPromo(iso, min) { return PROBAR_2X1 || (abreElDia(iso) && min >= minutosDe(PROMO.desde) && min < minutosDe(PROMO.hasta)); }
  function promoActiva() { const a = limaAhora(); return enHorarioPromo(a.iso, a.min); }
  /* La hora que cuenta: en recojo y reserva, la elegida; en delivery, la de envío (o la de entrega programada) */
  function momentoPedido() {
    if (pideHorario() && horario.dia && horario.hora !== null) return { iso: horario.dia, min: horario.hora };
    return limaAhora();
  }
  function esTrago(l) { return esCategoriaPromo(categoriaDe(porId.get(l.producto))); }
  /* Por cada 2 tragos, el de menor precio va gratis: se ordenan de mayor a menor y se regala el 2.º de cada par */
  function promo2x1() {
    const precios = [];
    lineasValidas().filter((l) => !l.otroDia && esTrago(l)).forEach((l) => {
      const pl = precioLinea(l);
      if (pl.base.tipo === "fijo") for (let i = 0; i < l.cantidad; i++) precios.push(pl.valor);
    });
    const m = momentoPedido();
    const vigente = enHorarioPromo(m.iso, m.min);
    precios.sort((a, b) => b - a);
    let monto = 0;
    if (vigente) for (let i = 1; i < precios.length; i += 2) monto += precios[i];
    return { vigente, tragos: precios.length, monto: Math.round(monto * 100) / 100 };
  }
  function totalPedido() { return Math.round((subtotal() - promo2x1().monto) * 100) / 100; }
  /* Reserva: adelanto redondeado al sol hacia arriba; el saldo es lo que falta */
  function montosReserva(total) {
    const adelanto = Math.min(total, Math.ceil(total * REGLAS.adelantoReserva));
    return { adelanto, saldo: Math.round((total - adelanto) * 100) / 100 };
  }
  function leerSoles(texto) {
    const n = Number(String(texto || "").replace(/s\/|\s/gi, "").replace(",", "."));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  }
  const porcentaje = () => Math.round(REGLAS.adelantoReserva * 100);
  const textoPromoHorario = () => `martes a domingo, de ${textoHora(minutosDe(PROMO.desde))} a ${textoHora(minutosDe(PROMO.hasta))}`;

  function textoNoIncluye(delivery) {
    return delivery ? "No incluye delivery" : "";
  }

  /* ---------- solo en el local (infusiones): solo con “Reserva en el local” ---------- */
  function lineasLocal() { return lineasValidas().filter((l) => porId.get(l.producto).soloLocal); }
  let quitadasLocal = []; // lo que se quitó al elegir delivery o recojo, por si el cliente vuelve a reserva
  function ocultarAvisoLocal() {
    const aviso = $("[data-aviso-local]");
    if (aviso) aviso.hidden = true;
    quitadasLocal = [];
  }
  function quitarLineasLocal() {
    const quitadas = lineasLocal();
    if (!quitadas.length) { ocultarAvisoLocal(); return; }
    quitadasLocal = quitadas.map((l) => JSON.parse(JSON.stringify(l)));
    lineas = lineas.filter((l) => !quitadas.includes(l));
    trasCambio();
    const nombres = quitadasLocal.map((l) => `${l.cantidad} x ${desglose(l).nombre}`);
    const lista = nombres.length > 1 ? nombres.slice(0, -1).join(", ") + " y " + nombres[nombres.length - 1] : nombres[0];
    const aviso = $("[data-aviso-local]");
    $("[data-aviso-local-texto]", aviso).textContent = `Las infusiones son solo para tomar en el local, así que quitamos ${lista} de tu pedido. Si prefieres tomarlas aquí, haz una reserva.`;
    // Junto a la modalidad si el pedido sigue con algo; si quedó vacío, arriba del mensaje de pedido vacío
    if (lineasValidas().length) $("[data-form-pedido] .segmentado--tres").after(aviso);
    else $("[data-pedido-vacio]").before(aviso);
    aviso.hidden = false;
  }
  /* Si la hoja marca algo como no disponible y ya estaba en el pedido guardado: lo de vitrina pasa a
     “para otro día” y lo demás sale del pedido. El aviso se muestra la próxima vez que se abre “Tu pedido”. */
  let avisoNoDisponible = "";
  function quitarNoDisponibles() {
    const quitadas = [];
    const manana = [];
    lineas = lineas.filter((l) => {
      const p = porId.get(l.producto);
      if (!p || !pedible(p) || l.otroDia || disponible(p, l.eleccion || {})) return true;
      if (paraOtroDia(p)) { l.otroDia = true; manana.push(l); return true; }
      quitadas.push(l);
      return false;
    });
    if (!quitadas.length && !manana.length) return;
    const nombres = (ls) => ls.map((l) => desglose(l).nombre).join(", ");
    avisoNoDisponible = [
      quitadas.length ? `${nombres(quitadas)} no está disponible hoy, así que lo quitamos de tu pedido.` : "",
      manana.length ? `${nombres(manana)} se acabó hoy: lo dejamos “para otro día”.` : "",
    ].filter(Boolean).join(" ");
    guardar(CLAVE_PEDIDO, lineas);
  }
  function volverAReserva() {
    const volver = quitadasLocal;
    ocultarAvisoLocal();
    formPedido().modalidad.value = MOD.reserva;
    volver.forEach((nueva) => {
      const existe = lineas.find((l) => claveLinea(l) === claveLinea(nueva));
      if (existe) existe.cantidad += nueva.cantidad; else lineas.push(nueva);
    });
    trasCambio();
    anunciar("Volvimos a “Reserva en el local” con tus infusiones.");
    $('[name="modalidad"][value="' + MOD.reserva + '"]')?.focus({ preventScroll: true });
  }

  function pintarPedido() {
    // Con algo “solo en el local” en el pedido, la modalidad es reserva
    if (lineasLocal().length && modalidad() !== MOD.reserva) { formPedido().modalidad.value = MOD.reserva; }
    const ls = lineasValidas();
    const n = unidades();
    const contador = $("[data-contador]");
    contador.hidden = n === 0;
    numero(contador, "contador", n);
    numero($("[data-barra-n]"), "barra-n", n);
    $("[data-barra-palabra]").textContent = n === 1 ? "producto" : "productos";
    numero($("[data-barra-total]"), "barra-total", totalPedido(), soles);
    actualizarBarra();

    $("[data-pedido-vacio]").hidden = ls.length > 0;
    $("[data-form-pedido]").hidden = ls.length === 0;
    $("[data-vaciar]").hidden = ls.length === 0;

    const hoy = ls.filter((l) => !l.otroDia);
    const otroDia = ls.filter((l) => l.otroDia);
    let html = hoy.map(htmlLinea).join("");
    if (otroDia.length) {
      html += `<li class="pedido__seccion"><h3>Para otro día</h3><p>Se acabaron hoy en vitrina. Coordinamos la fecha por WhatsApp.</p></li>`;
      html += otroDia.map(htmlLinea).join("");
    }
    $("[data-lista]").innerHTML = html;
    animarNumerosEn($("[data-lista]"));
    pintarTotales();
  }
  /* Totales, promo, adelanto y saldo, pago y horario: dependen de la modalidad y de la hora elegida */
  function pintarTotales() {
    const form = formPedido();
    const m = modalidad();
    const ls = lineasValidas();
    pintarHorario();
    const promo = promo2x1();
    const total = totalPedido();
    const hayCotiza = ls.some((l) => desglose(l).total);
    numero($("[data-subtotal]"), "subtotal", subtotal(), soles);
    $("[data-promo-linea]").hidden = !promo.monto;
    $("[data-total-linea]").hidden = !promo.monto;
    if (promo.monto) {
      numero($("[data-promo-monto]"), "promo", promo.monto, (v) => "−" + soles(v));
      numero($("[data-total]"), "total", total, soles);
    }
    // Ayuda de la promo: cuántos tragos faltan, o por qué no aplica
    const ayuda = $("[data-promo-ayuda]");
    let textoAyuda = "";
    if (promo.tragos) {
      if (!promo.vigente) textoAyuda = `La promo 2x1 en tragos es de ${textoPromoHorario()}${pideHorario(m) ? ", según la hora que elijas" : ""}.`;
      else if (promo.tragos % 2 === 1) textoAyuda = "Promo 2x1: agrega otro trago y el de menor precio va gratis.";
    }
    ayuda.textContent = textoAyuda;
    ayuda.hidden = !textoAyuda;
    $("[data-legal]").hidden = !promo.tragos;
    numero($("[data-barra-total]"), "barra-total", total, soles);
    // Reserva: adelanto y saldo
    const reserva = m === MOD.reserva;
    const { adelanto, saldo } = montosReserva(total);
    $("[data-reserva-montos]").hidden = !reserva;
    if (reserva) {
      $("[data-adelanto-etiqueta]").textContent = `Adelanto ${porcentaje()}% por Yape`;
      numero($("[data-adelanto]"), "adelanto", adelanto, soles);
      numero($("[data-saldo]"), "saldo", saldo, soles);
    }
    $("[data-nota-total]").textContent = [m === MOD.delivery ? textoNoIncluye(true) : "", hayCotiza ? "Lo que se cotiza no está incluido" : ""].filter(Boolean).join(" · ");
    // Bloques de cada modalidad
    $("[data-solo-delivery]").hidden = m !== MOD.delivery;
    $("[data-solo-reserva]").hidden = !reserva;
    $("[data-saldo-pago]").hidden = !reserva || saldo <= 0; // sin saldo (todo cubierto por el adelanto) no se pregunta
    $("[data-modalidad-ayuda]").textContent = m === MOD.delivery ? "Te lo llevamos a tu casa, en todo Villa El Salvador."
      : m === MOD.recojo ? "Lo recoges en el local a la hora que elijas." : "Separas tu pedido y vienes a comer al local.";
    $("[data-ayuda-local]").hidden = !ls.some((l) => porId.get(l.producto).soloLocal);
    const estimado = $("[data-entrega-estimada]");
    estimado.hidden = m !== MOD.delivery || pideHorario(m);
    const est = estadoLocal();
    estimado.innerHTML = est.abierto
      ? `<strong>Llega en unos ${esc(REGLAS.deliveryEstimado)}</strong> desde que confirmamos tu pago.`
      : `<strong>Llega en unos ${esc(REGLAS.deliveryEstimado)}</strong> desde que abrimos. ${esc(est.texto)}.`;
    $("[data-pago-texto]").innerHTML = reserva
      ? `<strong>Adelanto de ${soles(adelanto)} por Yape</strong> (${porcentaje()}%) para separar tu pedido. Te enviamos el número por WhatsApp.`
      : "<strong>Pagas el 100% por Yape</strong> antes de que empecemos a preparar. Te enviamos el número por WhatsApp.";
    $("[data-saldo-legend]").textContent = `¿Cómo pagarás el saldo de ${soles(saldo)} en el local?`;
    const efectivo = reserva && saldo > 0 && form.saldo.value === "Efectivo";
    $("[data-con-cuanto]").hidden = !efectivo;
    const paga = leerSoles(form.conCuanto.value);
    $("[data-vuelto]").textContent = efectivo && paga !== null && paga >= saldo ? `Tu vuelto: ${soles(paga - saldo)}` : "";
    $("[data-condicion-encargo]").hidden = !ls.some((l) => desglose(l).encargo);
  }

  function abrirPedido() {
    ocultarAvisoLocal();
    const avisoNd = $("[data-aviso-nodisp]");
    avisoNd.textContent = avisoNoDisponible;
    avisoNd.hidden = !avisoNoDisponible;
    avisoNoDisponible = "";
    pintarPedido();
    abrirDialogo(hojaPedido);
  }
  /* barra inferior: estado normal, “redirigido” y versión clara sobre fondos oscuros */
  function actualizarBarra() {
    const barra = $("[data-barra-pedido]");
    const algunDialogo = hojaPedido.open || hojaProducto.open || gracias.open;
    barra.hidden = unidades() === 0 || algunDialogo;
    barra.classList.toggle("barra-pedido--enviado", Boolean(enviado));
    $("[data-barra-ver]").textContent = enviado ? "Redirigido a WhatsApp" : "Ver pedido";
    revisarFondoBarra();
  }
  let fondoPendiente = false;
  function revisarFondoBarra() {
    if (fondoPendiente) return;
    fondoPendiente = true;
    requestAnimationFrame(() => {
      fondoPendiente = false;
      const barra = $("[data-barra-pedido]");
      const pastilla = $("[data-pastilla-estado]");
      // Todas las medidas antes de cambiar clases, para no forzar un recálculo de estilos a mitad de cuadro
      const zonas = $$("[data-fondo-oscuro]").map((s) => s.getBoundingClientRect());
      const sobreOscuro = (y) => zonas.some((r) => r.top <= y && r.bottom >= y);
      const oscuro = sobreOscuro(innerHeight - 40);
      // La pastilla "Abierto ahora" también se aclara sobre fondos oscuros (se mira su propio centro)
      let pastillaOscura = false;
      if (pastilla) {
        const p = pastilla.getBoundingClientRect();
        pastillaOscura = sobreOscuro(p.top + p.height / 2);
      }
      barra.classList.toggle("barra-pedido--clara", oscuro);
      pastilla?.classList.toggle("pastilla-estado--clara", pastillaOscura);
    });
  }

  function mensajeLinea(l) {
    const d = desglose(l);
    const partes = [`${l.cantidad} x ${d.nombre} - ${d.precio}`];
    if (d.cremas) partes.push(`   ${d.cremas}`);
    d.extras.forEach((x) => partes.push(`   ${x.texto} - ${x.precio}`));
    if (d.total) partes.push(`   ${d.total}`);
    if (d.aviso) partes.push(`   ${d.aviso}`);
    return partes.join("\n");
  }

  function enviarPedido(evento) {
    evento.preventDefault();
    const form = evento.currentTarget;
    const d = Object.fromEntries(new FormData(form));
    const m = d.modalidad;
    const delivery = m === MOD.delivery;
    const reserva = m === MOD.reserva;
    let valido = true;
    const marcarError = (campo, mensaje, foco) => {
      const input = foco || form.elements[campo];
      const salida = $(`[data-error="${campo}"]`, form);
      if (input && input.setAttribute && form.elements[campo]) input.setAttribute("aria-invalid", mensaje ? "true" : "false");
      if (salida) salida.textContent = mensaje || "";
      if (mensaje && valido) { input?.focus(); valido = false; }
    };
    pintarTotales();
    const total = totalPedido();
    const { adelanto, saldo } = montosReserva(total);
    const conCuanto = leerSoles(d.conCuanto);
    marcarError("nombre", d.nombre.trim() ? "" : "Escribe tu nombre para saber a quién atender.");
    marcarError("direccion", delivery && !d.direccion.trim() ? "Necesitamos la dirección para el delivery." : "");
    if (pideHorario(m)) {
      const falta = horario.dia ? "" : !primerDiaPosible(m) ? "No hay días disponibles para este pedido. Escríbenos por WhatsApp."
        : reserva ? "Elige en el calendario el día de tu reserva." : delivery ? "Elige en el calendario el día de entrega." : "Elige en el calendario el día de recojo.";
      marcarError("horario", falta, $(".horario .calendario__dia[tabindex=\"0\"]", form) || $(".horario .calendario__mes", form));
    }
    if (reserva && saldo > 0 && d.saldo === "Efectivo") {
      marcarError("conCuanto", conCuanto === null ? "Escribe con cuánto pagarás el saldo." : conCuanto < saldo ? `El monto debe ser de al menos ${soles(saldo)}.` : "");
    } else if (form.elements.conCuanto) {
      marcarError("conCuanto", "");
    }
    if (!valido) return;

    guardar(CLAVE_CLIENTE, { nombre: d.nombre, direccion: d.direccion, referencia: d.referencia });

    const ls = lineasValidas();
    const hoy = ls.filter((l) => !l.otroDia);
    const otroDia = ls.filter((l) => l.otroDia);
    const promo = promo2x1();
    const partes = [reserva ? "¡Hola, La Rejita Gourmet! Quiero hacer una reserva con este pedido:" : "¡Hola, La Rejita Gourmet! Quiero hacer este pedido:", ""];
    if (PROBAR_2X1) partes.unshift("[PRUEBA DE LA PROMO 2x1: no preparar]", "");
    if (hoy.length) partes.push(hoy.map(mensajeLinea).join("\n\n"));
    if (otroDia.length) partes.push(...(hoy.length ? [""] : []), "PARA OTRO DÍA (se acabaron hoy; coordinamos la fecha):", otroDia.map(mensajeLinea).join("\n\n"));
    partes.push("", `Subtotal: ${soles(subtotal())}`);
    if (promo.monto) partes.push(`Promo 2x1 aplicada (tragos): -${soles(promo.monto)}`, `Total: ${soles(total)}`);
    if (delivery) partes.push(textoNoIncluye(true));
    if (ls.some((l) => desglose(l).total)) partes.push("Lo que se cotiza no está incluido.");
    partes.push("", `Modalidad: ${m}`);
    const momento = pideHorario(m) ? textoMomento(horario.dia, horario.hora) + (fechaPorConfirmar() ? " (sujeta a confirmación)" : "") : "";
    if (delivery) {
      partes.push(momento ? `Entrega: ${momento}` : `Entrega: lo antes posible (llega en unos ${REGLAS.deliveryEstimado})`);
      partes.push(`Dirección: ${d.direccion.trim()}`);
      if (d.referencia.trim()) partes.push(`Referencia: ${d.referencia.trim()}`);
      partes.push("Pago: 100% por Yape antes de preparar");
    } else if (reserva) {
      partes.push(`Personas: ${d.personas}`, `Día y hora: ${momento}`);
      partes.push(`Adelanto (${porcentaje()}%) por Yape: ${soles(adelanto)}`);
      partes.push(saldo > 0 ? `Saldo en el local: ${soles(saldo)} (${d.saldo.toLowerCase()})` : "Saldo en el local: S/ 0.00 (el adelanto cubre todo)");
      if (saldo > 0 && d.saldo === "Efectivo") partes.push(`Pagaré con: ${soles(conCuanto)} (vuelto: ${soles(conCuanto - saldo)})`);
    } else {
      partes.push(`Hora de recojo: ${momento}`, "Pago: 100% por Yape antes de preparar");
    }
    partes.push(`Nombre: ${d.nombre.trim()}`);
    if (d.notas.trim()) partes.push(`Notas: ${d.notas.trim()}`);
    partes.push("", delivery ? "¿Me confirman la disponibilidad y el total incluyendo el delivery?"
      : reserva ? "¿Me confirman la reserva y me envían el número de Yape para el adelanto?" : "¿Me confirman la disponibilidad?");

    const url = urlWhatsApp(partes.join("\n"));
    abrirWhatsApp(url);
    enviado = url;
    cerrarDialogo(hojaPedido, () => mostrarGracias(url, "pedido"));
  }

  function urlWhatsApp(mensaje) {
    return `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(mensaje)}`;
  }
  /* Abre WhatsApp solo en una pestaña nueva; la página actual nunca se redirige. */
  function abrirWhatsApp(url) {
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.target = "_blank";
    enlace.rel = "noopener noreferrer";
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
  }

  /* ---------- pop-up de gracias ---------- */
  function mostrarGracias(url, tipo) {
    const pedido = tipo === "pedido";
    $("[data-gracias-titulo]").textContent = pedido ? "¡Gracias por tu pedido!" : "¡Gracias por escribirnos!";
    $("[data-gracias-texto]").textContent = pedido
      ? "Termina de enviarlo en WhatsApp y te lo confirmamos ahí."
      : "Termina de enviar tu consulta en WhatsApp y te respondemos ahí.";
    $("[data-gracias-whatsapp]").href = url;
    $("[data-nuevo-pedido]").hidden = !pedido;
    abrirDialogo(gracias);
  }

  /* Vaciar con animación y “Deshacer” durante unos segundos */
  let respaldoVaciado = null;
  let relojAviso = null;
  function vaciarPedido() {
    if (!lineas.length) return;
    respaldoVaciado = lineas.map((l) => ({ ...l }));
    const items = $$("[data-lista] > li");
    const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;
    items.forEach((li, i) => {
      li.style.transitionDelay = reducido ? "0ms" : `${Math.min(i, 6) * 45}ms`;
      li.classList.add("saliendo");
    });
    setTimeout(() => {
      lineas = [];
      trasCambio();
      mostrarAvisoVaciado();
      anunciar("Pedido vaciado. Puedes deshacerlo.");
    }, reducido ? 0 : 320 + Math.min(items.length, 6) * 45);
  }
  function mostrarAvisoVaciado() {
    const aviso = $("[data-aviso-vaciado]");
    aviso.hidden = false;
    requestAnimationFrame(() => aviso.classList.add("visible"));
    clearTimeout(relojAviso);
    relojAviso = setTimeout(ocultarAvisoVaciado, 6000);
  }
  function ocultarAvisoVaciado() {
    const aviso = $("[data-aviso-vaciado]");
    aviso.classList.remove("visible");
    setTimeout(() => { if (!aviso.classList.contains("visible")) aviso.hidden = true; }, 300);
    respaldoVaciado = null;
  }
  function deshacerVaciado() {
    if (!respaldoVaciado) return;
    lineas = respaldoVaciado;
    respaldoVaciado = null;
    clearTimeout(relojAviso);
    trasCambio();
    $$("[data-lista] > li").forEach((li, i) => {
      li.classList.add("entrando");
      li.style.animationDelay = `${Math.min(i, 6) * 40}ms`;
    });
    ocultarAvisoVaciado();
    anunciar("Recuperamos tu pedido.");
  }

  function nuevoPedido() {
    lineas = [];
    $("[data-form-pedido]").elements.notas.value = "";
    trasCambio();
    cerrarDialogo(gracias);
    anunciar("Listo, empezamos un pedido nuevo.");
  }

  /* ---------- catálogo de eventos y “Elegiste:” ----------
     Los productos de tipo "evento" se eligen dentro del formulario de la celebración. No van a “Tu pedido”:
     la solicitud de evento tiene su propio mensaje de WhatsApp y termina pidiendo la cotización. */
  function esDeEvento(p) { return Boolean(p) && p.tipo === "evento"; }
  function lineasEventoValidas() { return lineasEvento.filter((l) => { const p = porId.get(l.producto); return esDeEvento(p) && disponible(p, l.eleccion || {}); }); }
  let alCambiarEvento = null; // lo usa el calendario de la cotización para revisar la anticipación
  function trasCambioEvento() {
    guardar(CLAVE_EVENTO, lineasEvento);
    pintarElegiste();
    pintarCatalogoEvento();
    if (alCambiarEvento) alCambiarEvento();
  }
  function agregarEvento(nueva) {
    const clave = claveLinea(nueva);
    const existe = lineasEvento.find((l) => claveLinea(l) === clave);
    if (existe) existe.cantidad += nueva.cantidad; else lineasEvento.push({ ...nueva, otroDia: false });
    trasCambioEvento();
    anunciar(`Agregaste ${porId.get(nueva.producto).nombre} a tu evento.`);
    const caja = $("[data-elegiste]");
    if (caja) { caja.classList.remove("late"); void caja.offsetWidth; caja.classList.add("late"); }
  }
  function cambiarEvento(clave, delta) {
    const l = lineasEvento.find((x) => claveLinea(x) === clave);
    if (!l) return;
    l.cantidad += delta;
    if (l.cantidad <= 0) lineasEvento = lineasEvento.filter((x) => x !== l);
    trasCambioEvento();
    anunciar(l.cantidad > 0 ? `${porId.get(l.producto).nombre}: ${l.cantidad}.` : `Quitaste ${porId.get(l.producto).nombre} de tu evento.`);
  }
  function cantidadEnEvento(linea) {
    return lineasEventoValidas().filter((l) => enLinea(l, linea)).reduce((s, l) => s + l.cantidad, 0);
  }
  function pintarCatalogoEvento() {
    const caja = $("[data-catalogo-evento]");
    if (!caja) return;
    const grupos = categorias.map((c) => ({ c, items: productos.filter((p) => p.categoria === c.nombre && esDeEvento(p)).flatMap(lineasDe).filter((l) => !agotadoLinea(l)) })).filter((g) => g.items.length);
    $("[data-ver-eventos]").hidden = !grupos.length;
    caja.innerHTML = grupos.map(({ c, items }) => `<section class="catalogo__grupo" aria-labelledby="ev-${c.id}" data-cat="${c.id}">
        <h3 class="catalogo__titulo" id="ev-${c.id}">${esc(c.nombre)}</h3>
        ${c.nota ? `<p class="catalogo__nota">${esc(c.nota)}</p>` : ""}
        <ul class="catalogo__lista">${items.map((linea) => {
          const p = linea.p;
          const precio = precioDeLinea(linea);
          const n = cantidadEnEvento(linea);
          const desc = p.descripcion;
          const resumen = resumenOpciones(linea);
          const foto = fotoPropiaDe(linea);
          return `<li class="catalogo__fila${foto ? " catalogo__fila--foto" : ""}" data-buscar="${esc(textoBuscableLinea(linea))}">
            ${foto ? `<img class="catalogo__mini" src="${esc(foto)}" alt="" width="1200" height="1600" loading="lazy" decoding="async">` : ""}
            <div class="catalogo__texto">
              <p class="catalogo__linea"><span class="catalogo__nombre">${esc(linea.nombre)}</span><span class="catalogo__puntos" aria-hidden="true"></span><span class="catalogo__precio">${precio}</span></p>
              ${desc ? `<p class="catalogo__desc">${esc(desc)}</p>` : ""}
              ${resumen ? `<p class="catalogo__opciones">${esc(resumen)}</p>` : ""}
              ${p.anticipacion && p.anticipacion !== c.anticipacion ? `<p class="catalogo__desc">Con ${p.anticipacion} días de anticipación.</p>` : ""}
            </div>
            <button type="button" class="agregar agregar--evento" data-abrir-evento="${p.id}" data-linea="${esc(linea.clave)}" aria-label="Agregar a tu evento: ${esc(linea.nombre)}">${ICONO.mas}<span>Agregar</span>${n ? `<b class="agregar__n">${n}<span class="visualmente-oculto"> elegidos</span></b>` : ""}</button>
          </li>`;
        }).join("")}</ul>
      </section>`).join("");
    buscarEnEventos();
  }
  /* Buscador y filtro de categoría del catálogo de eventos: funcionan juntos.
     El buscador filtra mientras se escribe, sin tildes ni mayúsculas; el filtro muestra cuántos hay en cada categoría. */
  let filtroEvento = "todas";
  function buscarEnEventos() {
    const campo = $("[data-buscar-evento]");
    const vacio = $("[data-catalogo-vacio]");
    if (!campo || !vacio) return;
    const texto = campo.value.trim();
    const q = normal(texto);
    const grupos = $$("[data-catalogo-evento] .catalogo__grupo");
    const conteo = new Map();
    grupos.forEach((g) => {
      let enGrupo = 0;
      $$(".catalogo__fila", g).forEach((f) => {
        const ok = !q || f.dataset.buscar.includes(q);
        f.hidden = !ok;
        if (ok) enGrupo++;
      });
      conteo.set(g.dataset.cat, { nombre: txtDe($(".catalogo__titulo", g)), n: enGrupo });
    });
    if (filtroEvento !== "todas" && !conteo.has(filtroEvento)) filtroEvento = "todas";
    grupos.forEach((g) => { g.hidden = (filtroEvento !== "todas" && g.dataset.cat !== filtroEvento) || conteo.get(g.dataset.cat).n === 0; });
    const todas = [...conteo.values()].reduce((s, x) => s + x.n, 0);
    const total = filtroEvento === "todas" ? todas : conteo.get(filtroEvento).n;
    pintarFiltro(conteo, todas);
    vacio.hidden = total > 0;
    if (!total) {
      const donde = filtroEvento === "todas" ? "en las opciones para eventos" : `en ${conteo.get(filtroEvento).nombre}`;
      vacio.innerHTML = `No encontramos “${esc(texto)}” ${esc(donde)}. Cuéntanos tu idea abajo, en “Tu idea”, o <a href="${urlWhatsApp("¡Hola, La Rejita Gourmet! Para un evento, ¿hacen " + texto + "?")}" target="_blank" rel="noopener">pregúntanos por WhatsApp</a>.`;
    }
  }
  function txtDe(el) { return el ? el.textContent.trim() : ""; }
  function pintarFiltro(conteo, todas) {
    const lista = $("[data-filtro-lista]");
    if (!lista) return;
    const enfocada = lista.contains(document.activeElement) ? document.activeElement.dataset.filtroOp : null;
    const opciones = [["todas", "Todas", todas], ...[...conteo].map(([id, x]) => [id, x.nombre, x.n])];
    lista.innerHTML = opciones.map(([id, nombre, n]) => `<li class="filtro__op" role="option" id="filtro-op-${esc(id)}" data-filtro-op="${esc(id)}" aria-selected="${id === filtroEvento}" tabindex="-1">
        <svg class="filtro__check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
        <span class="filtro__nombre">${esc(nombre)}</span>
        <span class="filtro__n" aria-label="${n} ${n === 1 ? "producto" : "productos"}">${n}</span>
      </li>`).join("");
    $("[data-filtro-valor]").textContent = opciones.find(([id]) => id === filtroEvento)[1];
    if (enfocada) $(`[data-filtro-op="${CSS.escape(enfocada)}"]`, lista)?.focus({ preventScroll: true });
  }
  function filtroAbierto() { return $("[data-filtro-boton]")?.getAttribute("aria-expanded") === "true"; }
  function abrirFiltro() {
    const lista = $("[data-filtro-lista]");
    const boton = $("[data-filtro-boton]");
    boton.setAttribute("aria-expanded", "true");
    lista.hidden = false;
    cancelAnimationFrame(lista._raf);
    lista._raf = requestAnimationFrame(() => { if (filtroAbierto()) lista.classList.add("visible"); });
    ($('[aria-selected="true"]', lista) || $(".filtro__op", lista))?.focus({ preventScroll: true });
  }
  function cerrarFiltro(devolverFoco) {
    const lista = $("[data-filtro-lista]");
    const boton = $("[data-filtro-boton]");
    if (!lista || !filtroAbierto()) return;
    boton.setAttribute("aria-expanded", "false");
    lista.classList.remove("visible");
    cancelAnimationFrame(lista._raf);
    setTimeout(() => { if (!filtroAbierto()) lista.hidden = true; }, 200);
    if (devolverFoco) boton.focus({ preventScroll: true });
  }
  function elegirFiltro(id) {
    filtroEvento = id;
    cerrarFiltro(true);
    buscarEnEventos();
    anunciar(`Categoría: ${$("[data-filtro-valor]").textContent}.`);
  }
  function conectarFiltro() {
    const filtro = $("[data-filtro]");
    if (!filtro) return;
    const boton = $("[data-filtro-boton]");
    const lista = $("[data-filtro-lista]");
    boton.addEventListener("click", () => (filtroAbierto() ? cerrarFiltro(false) : abrirFiltro()));
    boton.addEventListener("keydown", (e) => { if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !filtroAbierto()) { e.preventDefault(); abrirFiltro(); } });
    lista.addEventListener("click", (e) => { const op = e.target.closest("[data-filtro-op]"); if (op) elegirFiltro(op.dataset.filtroOp); });
    lista.addEventListener("keydown", (e) => {
      const ops = $$(".filtro__op", lista);
      const i = ops.indexOf(document.activeElement);
      const ir = (j) => { e.preventDefault(); ops[(j + ops.length) % ops.length]?.focus(); };
      if (e.key === "ArrowDown") ir(i + 1);
      else if (e.key === "ArrowUp") ir(i - 1);
      else if (e.key === "Home") ir(0);
      else if (e.key === "End") ir(ops.length - 1);
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (ops[i]) elegirFiltro(ops[i].dataset.filtroOp); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cerrarFiltro(true); }
      else if (e.key === "Tab") cerrarFiltro(false);
    });
    // Al tocar fuera se cierra
    document.addEventListener("pointerdown", (e) => { if (filtroAbierto() && !filtro.contains(e.target)) cerrarFiltro(false); });
  }
  function totalEvento() {
    const ls = lineasEventoValidas();
    return { suma: Math.round(ls.reduce((s, l) => s + desglose(l).suma, 0) * 100) / 100, cotiza: ls.some((l) => desglose(l).total) };
  }
  // Solo cosas a cotizar (p. ej. Decoración): "A cotizar", no "S/ 0.00 + lo que se cotice"
  function textoTotalEvento(t) { return !t.suma && t.cotiza ? "A cotizar" : `${soles(t.suma)}${t.cotiza ? " + lo que se cotice" : ""}`; }
  function pintarElegiste() {
    const caja = $("[data-elegiste]");
    if (!caja) return;
    const ls = lineasEventoValidas();
    caja.hidden = !ls.length;
    if (!ls.length) { caja.innerHTML = ""; return; }
    const t = totalEvento();
    caja.innerHTML = `<p class="elegiste__titulo">Elegiste: <small>precios referenciales</small></p>
      <ul class="elegiste__lista">${ls.map((l) => {
        const d = desglose(l);
        const clave = claveLinea(l);
        const linea = lineaPara(d.p, l.eleccion || {});
        const unitario = d.suma && l.cantidad > 1 ? `${soles(d.suma / l.cantidad)} c/u` : "";
        return `<li class="elegiste__fila">
          <div class="elegiste__texto">
            <button type="button" class="elegiste__nombre" data-abrir-evento="${d.p.id}" data-linea="${esc(linea.clave)}" aria-label="Editar ${esc(d.nombre)}">${l.cantidad} x ${esc(d.nombre)}</button>
            <span class="elegiste__monto">${d.suma ? soles(d.suma) : esc(d.precio)}</span>
            ${d.cremas ? `<span class="elegiste__detalle">${esc(d.cremas)}</span>` : ""}
            ${d.extras.map((x) => `<span class="elegiste__detalle">${esc(x.texto)}</span>`).join("")}
            ${unitario ? `<span class="elegiste__detalle">${unitario}</span>` : ""}
          </div>
          <div class="paso paso--oscuro" role="group" aria-label="Cantidad de ${esc(d.p.nombre)}">
            ${l.cantidad <= 1
              ? `<button type="button" data-evento-quitar="${esc(clave)}" aria-label="Quitar ${esc(d.p.nombre)}">${ICONO.tacho}</button>`
              : `<button type="button" data-evento-restar="${esc(clave)}" aria-label="Quitar uno">${ICONO.menos}</button>`}
            <output>${l.cantidad}</output>
            <button type="button" data-evento-sumar="${esc(clave)}" aria-label="Agregar uno más">${ICONO.mas}</button>
          </div>
        </li>`;
      }).join("")}</ul>
      <p class="elegiste__total"><span>Total referencial</span><strong>${textoTotalEvento(t)}</strong></p>`;
  }
  /* El catálogo puede desbordar (para que la lista del filtro no se corte) solo cuando ya está abierto
     a su altura completa; si la animación aún no termina, se vuelve a revisar. */
  function marcarListo(panel, intentos = 0) {
    clearTimeout(panel._listo);
    panel._listo = setTimeout(() => {
      if (!panel.classList.contains("despliegue--abierto")) return;
      const interior = $(".despliegue__interior", panel);
      if (panel.getBoundingClientRect().height >= interior.scrollHeight - 2) panel.classList.add("despliegue--listo");
      else if (intentos < 20) marcarListo(panel, intentos + 1);
    }, intentos ? 150 : 560);
  }
  function conectarEventos() {
    const boton = $("[data-ver-eventos]");
    const panel = $("[data-catalogo-evento-panel]");
    if (!boton || !panel) return;
    const herramientas = $(".catalogo__herramientas", panel);
    const movimiento = () => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");
    function alternarCatalogo(abrir) {
      boton.setAttribute("aria-expanded", String(abrir));
      $("[data-catalogo-texto]", boton).textContent = abrir ? "Ocultar opciones para tu evento" : "Ver opciones para tu evento";
      panel.classList.toggle("despliegue--abierto", abrir);
      // Ya abierto, el contenido puede desbordar (lista del filtro y fila fija del buscador)
      clearTimeout(panel._listo);
      panel.classList.remove("despliegue--listo");
      if (abrir) marcarListo(panel); else cerrarFiltro(false);
      if (abrir) panel.removeAttribute("inert"); else panel.setAttribute("inert", "");
      revisarFija();
    }
    /* Cerrar desde la fila fija o desde el final: se pliega y la página sube hasta el botón “Ver opciones…” */
    function cerrarCatalogo() {
      alternarCatalogo(false);
      const y = boton.getBoundingClientRect().top + scrollY - parseFloat(getComputedStyle(herramientas).top || 0) - 24;
      if (boton.getBoundingClientRect().top < 0 || boton.getBoundingClientRect().top > innerHeight) scrollTo({ top: Math.max(0, y), behavior: movimiento() });
      boton.focus({ preventScroll: true });
      anunciar("Cerramos las opciones para tu evento.");
    }
    /* Fila del buscador: se marca “fija” (con fondo y sombra) solo mientras está pegada arriba */
    const interior = $(".despliegue__interior", panel);
    function revisarFija() {
      if (!herramientas) return;
      const abierto = panel.classList.contains("despliegue--abierto");
      if (!abierto && !herramientas.classList.contains("catalogo__herramientas--fija")) return; // cerrado: nada que medir
      const tope = parseFloat(getComputedStyle(herramientas).top) || 0;
      const fija = abierto && herramientas.getBoundingClientRect().top <= tope + 1 && interior.getBoundingClientRect().bottom > tope + herramientas.offsetHeight + 8;
      herramientas.classList.toggle("catalogo__herramientas--fija", fija);
    }
    window.addEventListener("scroll", revisarFija, { passive: true });
    window.addEventListener("resize", revisarFija);
    boton.addEventListener("click", () => alternarCatalogo(boton.getAttribute("aria-expanded") !== "true"));
    $$("[data-cerrar-catalogo]", panel).forEach((b) => b.addEventListener("click", cerrarCatalogo));
    $("[data-buscar-evento]")?.addEventListener("input", buscarEnEventos);
    conectarFiltro();
    document.addEventListener("click", (e) => {
      const abrir = e.target.closest("[data-abrir-evento]");
      if (abrir) { abrirProducto(abrir.dataset.abrirEvento, undefined, abrir.dataset.linea, { destino: "evento" }); return; }
      const sumar = e.target.closest("[data-evento-sumar]");
      if (sumar) { cambiarEvento(sumar.dataset.eventoSumar, 1); return; }
      const restar = e.target.closest("[data-evento-restar]");
      if (restar) { cambiarEvento(restar.dataset.eventoRestar, -1); return; }
      const quitar = e.target.closest("[data-evento-quitar]");
      if (quitar) {
        cambiarEvento(quitar.dataset.eventoQuitar, -1);
        // El foco vuelve a la lista (o a "Tu idea" si quedó vacía)
        ($("[data-elegiste] .elegiste__nombre") || $('[data-cotizar] [name="idea"]'))?.focus({ preventScroll: true });
      }
    });
  }

  /* ---------- cotización de eventos ---------- */
  function hoyLima() {
    const f = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return new Date(f + "T00:00:00");
  }
  function iso(fecha) {
    return fecha.getFullYear() + "-" + String(fecha.getMonth() + 1).padStart(2, "0") + "-" + String(fecha.getDate()).padStart(2, "0");
  }
  function prepararCotizacion() {
    const form = $("[data-cotizar]");
    const fecha = $("[data-fecha]");
    const aviso = $("[data-aviso-fecha]");
    const boton = $("[data-fecha-boton]");
    const textoFecha = $("[data-fecha-texto]");
    const cal = $("[data-calendario]");
    const titulo = $("[data-cal-titulo]");
    const rejilla = $("[data-cal-dias]");
    const pie = $("[data-cal-pie]");
    const hoy = hoyLima();
    const formatoLargo = new Intl.DateTimeFormat("es-PE", { weekday: "long", day: "numeric", month: "long" });
    const formatoMes = new Intl.DateTimeFormat("es-PE", { month: "long", year: "numeric" });
    let visto = null; // primer día del mes que se muestra

    // La anticipación la ponen los productos elegidos (manda la más larga); sin nada elegido, la de eventos
    const diasTipo = () => Math.max(0, ...lineasEventoValidas().map((l) => porId.get(l.producto).anticipacion || 0)) || DIAS_EVENTO;
    const minima = () => { const m = new Date(hoy); m.setDate(m.getDate() + diasTipo()); return m; };
    const elegida = () => (fecha.value ? new Date(fecha.value + "T00:00:00") : null);
    const mismoDia = (a, b) => a && b && a.toDateString() === b.toDateString();

    function pintarCalendario(enfocar) {
      const min = minima();
      if (!visto) visto = new Date((elegida() || min).getFullYear(), (elegida() || min).getMonth(), 1);
      const nombreMes = formatoMes.format(visto);
      titulo.textContent = nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1);
      const primerMesPosible = new Date(min.getFullYear(), min.getMonth(), 1);
      $("[data-cal-mes='-1']").disabled = visto <= primerMesPosible;
      const inicio = (visto.getDay() + 6) % 7; // lunes primero
      const diasMes = new Date(visto.getFullYear(), visto.getMonth() + 1, 0).getDate();
      let html = "";
      for (let i = 0; i < inicio; i++) html += '<span class="calendario__vacio" aria-hidden="true"></span>';
      for (let d = 1; d <= diasMes; d++) {
        const dia = new Date(visto.getFullYear(), visto.getMonth(), d);
        const bloqueado = dia < min;
        const sel = mismoDia(dia, elegida());
        html += `<button type="button" class="calendario__dia${sel ? " calendario__dia--elegido" : ""}${mismoDia(dia, hoy) ? " calendario__dia--hoy" : ""}" data-dia="${iso(dia)}" aria-label="${formatoLargo.format(dia)}${bloqueado ? ", no disponible" : ""}" ${sel ? 'aria-pressed="true"' : ""} ${bloqueado ? "disabled" : ""} tabindex="-1">${d}</button>`;
      }
      rejilla.innerHTML = html;
      pie.textContent = `Por la anticipación, puedes elegir desde el ${formatoLargo.format(min)} (${diasTipo()} días).`;
      const activos = $$(".calendario__dia:not([disabled])", rejilla);
      const foco = activos.find((b) => b.getAttribute("aria-pressed")) || activos[0];
      if (foco) foco.tabIndex = 0;
      if (enfocar && foco) foco.focus();
    }
    function abrirCalendario() {
      visto = null;
      cal.hidden = false;
      boton.setAttribute("aria-expanded", "true");
      pintarCalendario(true);
      requestAnimationFrame(() => cal.classList.add("visible"));
    }
    function cerrarCalendario(devolverFoco) {
      cal.classList.remove("visible");
      boton.setAttribute("aria-expanded", "false");
      setTimeout(() => { if (!cal.classList.contains("visible")) cal.hidden = true; }, 220);
      if (devolverFoco) boton.focus();
    }
    function elegir(valor) {
      fecha.value = valor;
      const d = new Date(valor + "T00:00:00");
      const texto = formatoLargo.format(d);
      textoFecha.textContent = texto.charAt(0).toUpperCase() + texto.slice(1);
      boton.classList.add("selector-fecha--lleno");
      aviso.hidden = true;
      errorEvento("fecha", "");
    }

    boton.addEventListener("click", () => (cal.hidden ? abrirCalendario() : cerrarCalendario(false)));
    $$("[data-cal-mes]", cal).forEach((b) => b.addEventListener("click", () => {
      visto = new Date(visto.getFullYear(), visto.getMonth() + Number(b.dataset.calMes), 1);
      pintarCalendario(false);
    }));
    rejilla.addEventListener("click", (e) => {
      const b = e.target.closest("[data-dia]");
      if (!b || b.disabled) return;
      elegir(b.dataset.dia);
      cerrarCalendario(true);
    });
    rejilla.addEventListener("keydown", (e) => {
      const b = e.target.closest("[data-dia]");
      if (!b) return;
      const pasos = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (!pasos) return;
      e.preventDefault();
      const destino = new Date(b.dataset.dia + "T00:00:00");
      destino.setDate(destino.getDate() + pasos);
      if (destino < minima()) return;
      if (destino.getMonth() !== visto.getMonth()) {
        visto = new Date(destino.getFullYear(), destino.getMonth(), 1);
        pintarCalendario(false);
      }
      const nuevo = rejilla.querySelector(`[data-dia="${iso(destino)}"]`);
      if (nuevo) { $$("[data-dia]", rejilla).forEach((x) => { x.tabIndex = -1; }); nuevo.tabIndex = 0; nuevo.focus(); }
    });
    cal.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); cerrarCalendario(true); } });
    document.addEventListener("click", (e) => {
      if (!cal.hidden && !cal.contains(e.target) && !boton.contains(e.target)) cerrarCalendario(false);
    });
    // Entrega del evento: con delivery se pide la dirección; con recojo se muestra la dirección del local.
    // Las dos se pliegan con la misma animación de alto (.plegable) y se cruzan: una se va mientras la otra llega.
    // Mientras están plegadas no se pueden enfocar (inert); al terminar de abrirse dejan de recortar,
    // para que se vea el contorno de foco del campo.
    const campoDireccion = $("[data-cotizar-direccion]");
    const lineaRecoges = $("[data-cotizar-recoges]");
    const plegar = (el, ver) => {
      if (!el || ver === el.classList.contains("plegable--abierto")) return;
      clearTimeout(el._reloj);
      el.classList.remove("plegable--listo");
      el.classList.toggle("plegable--abierto", ver);
      el.inert = !ver;
      if (ver) el._reloj = setTimeout(() => el.classList.add("plegable--listo"), 450);
    };
    const ajustarEntrega = () => {
      const delivery = form.entrega.value === "Delivery";
      plegar(campoDireccion, delivery);
      plegar(lineaRecoges, !delivery);
      if (!delivery) errorEvento("direccion", "");
    };
    ajustarEntrega();
    /* Avisos de cada campo: aparecen en su campo, se borran al corregirlo */
    function errorEvento(campo, mensaje) {
      const salida = $(`[data-error-evento="${campo}"]`, form);
      if (salida) salida.textContent = mensaje;
      const control = campo === "fecha" ? boton : form.elements[campo];
      if (control) control.setAttribute("aria-invalid", mensaje ? "true" : "false");
    }
    /* “Tu idea” es obligatoria solo si en “Elegiste” hay algo personalizable */
    const ideaNecesaria = () => lineasEventoValidas().some((l) => porId.get(l.producto).personalizable);
    function pintarIdea() {
      const necesaria = ideaNecesaria();
      $("[data-idea-estado]", form).textContent = necesaria ? "(necesaria para cotizar lo personalizado)" : "(opcional)";
      form.elements.idea.required = necesaria;
      if (!necesaria) errorEvento("idea", "");
    }
    pintarIdea();
    const revisarFecha = (motivo) => {
      const actual = elegida();
      if (actual && actual < minima()) {
        fecha.value = "";
        textoFecha.textContent = "Elige una fecha";
        boton.classList.remove("selector-fecha--lleno");
        aviso.hidden = false;
        aviso.textContent = `Para ${motivo} necesitamos ${diasTipo()} días de anticipación. Elige una fecha desde el ${formatoLargo.format(minima())}.`;
      }
      if (!cal.hidden) { visto = null; pintarCalendario(false); }
    };
    const avisoElegiste = $("[data-aviso-elegiste]");
    alCambiarEvento = () => {
      revisarFecha("lo que elegiste");
      pintarIdea();
      if (lineasEventoValidas().length) avisoElegiste.hidden = true;
    };
    form.addEventListener("change", (e) => {
      if (e.target.name === "entrega") ajustarEntrega();
    });
    // Al corregir un campo, su aviso se va
    form.addEventListener("input", (e) => {
      if (["idea", "direccion", "nombre"].includes(e.target.name) && e.target.value.trim()) errorEvento(e.target.name, "");
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(form));
      const elegidos = lineasEventoValidas();
      const conEntrega = d.entrega === "Delivery";
      // Se revisa en el orden del formulario; cada aviso va en su campo y se lleva al primero que falta
      const faltas = [];
      avisoElegiste.hidden = elegidos.length > 0;
      if (!elegidos.length) faltas.push($("[data-ver-eventos]"));
      const sinIdea = ideaNecesaria() && !d.idea.trim();
      errorEvento("idea", sinIdea ? "Cuéntanos tu idea para cotizar lo personalizado: temática, colores, nombre en la torta…" : "");
      if (sinIdea) faltas.push(form.elements.idea);
      errorEvento("fecha", d.fecha ? "" : "Elige la fecha de tu evento para revisar disponibilidad.");
      if (!d.fecha) faltas.push(boton);
      const sinDireccion = conEntrega && !d.direccion.trim();
      errorEvento("direccion", sinDireccion ? "Escribe la dirección de entrega o del lugar del evento (o elige recojo en el local)." : "");
      if (sinDireccion) faltas.push(form.elements.direccion);
      errorEvento("nombre", d.nombre.trim() ? "" : "Escribe tu nombre para saber a quién responder.");
      if (!d.nombre.trim()) faltas.push(form.elements.nombre);
      if (faltas.length) {
        const primero = faltas[0];
        primero.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        primero.focus({ preventScroll: true });
        if (!elegidos.length) anunciar(avisoElegiste.textContent);
        return;
      }
      const legible = new Intl.DateTimeFormat("es-PE", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(d.fecha + "T12:00:00"));
      // Orden: lo elegido (con precios referenciales), la idea y los datos del evento
      const t = totalEvento();
      const partes = ["¡Hola, La Rejita Gourmet! Quiero cotizar un evento.", "", "Elegiste (precios referenciales):", elegidos.map(mensajeLinea).join("\n"),
        `Total referencial: ${textoTotalEvento(t)}`];
      if (d.idea.trim()) partes.push("", `Mi idea: ${d.idea.trim()}`);
      partes.push("", "Datos del evento:", `Fecha: ${legible}`);
      if (d.personas.trim()) partes.push(`Personas: ${d.personas.trim()}`);
      if (conEntrega) partes.push("Entrega: delivery", `Dirección: ${d.direccion.trim()}`);
      else partes.push("Entrega: recojo en el local");
      partes.push(`Nombre: ${d.nombre.trim()}`, "", "¿Me envían la cotización, por favor?");
      const url = urlWhatsApp(partes.join("\n"));
      abrirWhatsApp(url);
      mostrarGracias(url, "cotizacion");
    });
  }

  /* ---------- Google Sheets: precios, disponibilidad y frase ---------- */
  function leerCsv(texto) {
    const filas = [];
    let fila = [];
    let campo = "";
    let comillas = false;
    for (let i = 0; i < texto.length; i++) {
      const c = texto[i];
      if (comillas) {
        if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
        else if (c === '"') comillas = false;
        else campo += c;
      } else if (c === '"') comillas = true;
      else if (c === ",") { fila.push(campo); campo = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && texto[i + 1] === "\n") i++;
        fila.push(campo); filas.push(fila); fila = []; campo = "";
      } else campo += c;
    }
    if (campo || fila.length) { fila.push(campo); filas.push(fila); }
    return filas;
  }
  async function traer(url) {
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), ESPERA_HOJA_MS);
    try {
      const r = await fetch(url, { signal: control.signal, cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      return await r.text();
    } finally {
      clearTimeout(reloj);
    }
  }
  function leerNumeroHoja(texto) {
    const limpio = String(texto).replace(/s\/|\s/gi, "");
    if (!limpio) return null;
    // Acepta 8 · 8.5 · 8,5 · 1,250.00
    const normalizado = /^\d+,\d{1,2}$/.test(limpio) ? limpio.replace(",", ".") : limpio.replace(/,/g, "");
    if (!/^\d+(\.\d+)?$/.test(normalizado)) return null;
    const n = Number(normalizado);
    return n > 0 && n < 10000 ? n : null;
  }
  function leerCasilla(texto) {
    const t = normal(texto).trim();
    if (["true", "verdadero", "si", "1"].includes(t)) return true;
    if (["false", "falso", "no", "0"].includes(t)) return false;
    return null;
  }
  /* Tipo de la columna "tipo" de la hoja → tipo interno. "adicional" o cualquier otro texto no cambia nada. */
  function leerTipo(texto) {
    const t = normal(texto).trim();
    if (t === "vitrina") return "vitrina";
    if (t === "siempre disponible" || t === "siempre") return "siempre";
    if (t === "por encargo" || t === "encargo") return "encargo";
    if (t === "evento" || t === "eventos") return "evento";
    return null;
  }
  async function aplicarHoja() {
    const hoja = datos?.config?.hoja || {};
    const tareas = [];
    if (hoja.productosCsv) {
      tareas.push(traer(hoja.productosCsv).then((texto) => {
        const filas = leerCsv(texto);
        const cabeza = (filas.shift() || []).map((c) => normal(c).trim());
        const cId = cabeza.indexOf("id");
        const cPrecio = cabeza.indexOf("precio");
        const cDisp = cabeza.indexOf("disponible");
        const cDesc = cabeza.indexOf("descripcion");
        const cTipo = cabeza.indexOf("tipo");
        if (cId < 0) return 0;
        const porEntrada = new Map();
        productos.forEach((p) => p.precios.forEach((e) => porEntrada.set(e.id, { p, e })));
        let cambios = 0;
        // 1.ª pasada: el tipo de cada producto se lee de su primera fila (antes de aplicar la disponibilidad,
        // que solo cuenta en productos de vitrina). Vacío o no válido = se queda el de productos.json.
        if (cTipo >= 0) {
          filas.forEach((f) => {
            const hallado = porEntrada.get((f[cId] || "").trim());
            if (!hallado || hallado.p.precios[0] !== hallado.e) return;
            const tipo = leerTipo(f[cTipo] || "");
            if (tipo && tipo !== hallado.p.tipo) { hallado.p.tipo = tipo; cambios++; }
          });
        }
        filas.forEach((f) => {
          const id = (f[cId] || "").trim();
          if (!id) return;
          const precio = cPrecio >= 0 ? leerNumeroHoja(f[cPrecio] || "") : null;
          const disp = cDisp >= 0 ? leerCasilla(f[cDisp] || "") : null;
          const hallado = porEntrada.get(id);
          if (hallado) {
            const { p, e } = hallado;
            // Un precio en la hoja también vale para lo “a cotizar” de productos.json (pasa a precio fijo)
            if (precio !== null) { e.precio = e.precio.tipo === "cotizar" ? { tipo: "fijo", valor: precio } : { ...e.precio, valor: precio }; cambios++; }
            // La casilla “disponible” cuenta en todo lo de la carta (vitrina, siempre disponible y por encargo), no en eventos
            if (disp !== null) { e.disponible = disp; cambios++; }
            // La descripción se lee de la primera fila de cada producto; vacía = se usa la de productos.json
            const desc = cDesc >= 0 ? (f[cDesc] || "").trim() : "";
            if (desc && desc.length <= 300 && p.precios[0] === e) { p.descripcion = desc; cambios++; }
          } else if (adicionalPorId.has(id)) {
            const a = adicionalPorId.get(id);
            if (precio !== null && a.precio.tipo === "fijo") { a.precio = { tipo: "fijo", valor: precio }; cambios++; }
          }
        });
        return cambios;
      }).catch(() => 0));
    }
    if (hoja.fraseCsv) {
      tareas.push(traer(hoja.fraseCsv).then((texto) => {
        const celdas = leerCsv(texto).map((f) => (f[0] || "").trim()).filter(Boolean);
        const frase = normal(celdas[0]) === "frase" ? celdas[1] : celdas[0];
        if (frase && frase.length <= 280) {
          $("[data-frase-texto]").textContent = frase;
          $("[data-frase]").hidden = false;
        }
        return 0;
      }).catch(() => 0));
    }
    const resultados = await Promise.all(tareas);
    if (resultados.some((n) => n > 0)) { quitarNoDisponibles(); repintarTodo(); }
  }

  function repintarTodo() {
    cacheLineas.clear(); // la hoja puede cambiar tipos y precios
    pintarVitrina();
    pintarCarta();
    refrescarControles();
    pintarPedido();
    pintarCatalogoEvento();
    pintarElegiste();
  }

  /* ---------- tarjeta flotante de la promo 2x1 ----------
     Solo en el horario de la promo, una vez por visita, en una esquina y sin tapar la página. */
  let relojPromo = null;
  function mostrarTarjetaPromo() {
    const tarjeta = $("[data-promo]");
    if (!tarjeta || !promoActiva() || !productos.some((p) => esCategoriaPromo(categoriaDe(p)) && enCarta(p))) return;
    try { if (sessionStorage.getItem(CLAVE_PROMO_VISTA)) return; sessionStorage.setItem(CLAVE_PROMO_VISTA, "1"); } catch { /* sin almacenamiento */ }
    $("[data-promo-hasta]", tarjeta).textContent = textoHora(minutosDe(PROMO.hasta));
    $("[data-promo-prueba]", tarjeta).hidden = !PROBAR_2X1;
    tarjeta.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => tarjeta.classList.add("visible")));
  }
  function cerrarTarjetaPromo() {
    const tarjeta = $("[data-promo]");
    tarjeta.classList.remove("visible");
    setTimeout(() => { tarjeta.hidden = true; }, 300);
  }
  /* Cada minuto: estado del local, horas posibles y promo (empieza a las 7 pm y termina a las 10 pm) */
  let promoAntes = null;
  function revisarReloj() {
    pintarEstado();
    const ahora = promoActiva();
    if (promoAntes !== null && ahora !== promoAntes) {
      pintarCarta();
      if (!ahora && !$("[data-promo]").hidden) cerrarTarjetaPromo();
    }
    if (ahora && !promoAntes) { clearTimeout(relojPromo); relojPromo = setTimeout(mostrarTarjetaPromo, 1500); }
    promoAntes = ahora;
    if (hojaPedido.open) pintarTotales(); else actualizarBarraTotal();
  }
  function actualizarBarraTotal() {
    if (productos.length) numero($("[data-barra-total]"), "barra-total", totalPedido(), soles);
  }

  /* ---------- eventos globales ---------- */
  function conectar() {
    document.addEventListener("click", (e) => {
      const abrir = e.target.closest("[data-abrir]");
      if (abrir) { abrirProducto(abrir.dataset.abrir, abrir.dataset.preset ? JSON.parse(abrir.dataset.preset) : undefined, abrir.dataset.linea); return; }
      const sumar = e.target.closest("[data-linea-sumar]");
      if (sumar) { cambiarLinea(sumar.dataset.lineaSumar, 1); return; }
      const restar = e.target.closest("[data-linea-restar]");
      if (restar) {
        // En “Tu pedido”, al quitar una línea el foco pasa a la siguiente (o al título si quedó vacío)
        const enHoja = restar.closest("[data-lista]");
        const indice = enHoja ? $$("[data-lista] .linea").indexOf(restar.closest(".linea")) : -1;
        cambiarLinea(restar.dataset.lineaRestar, -1);
        if (enHoja && restar.hasAttribute("data-quitar-linea")) {
          const filas = $$("[data-lista] .linea");
          const destino = filas[Math.min(indice, filas.length - 1)];
          ($("button", destino || document.createElement("div")) || $("#pedido-titulo"))?.focus({ preventScroll: true });
        }
        return;
      }
      if (e.target.closest("[data-volver-reserva]")) { volverAReserva(); return; }
      if (e.target.closest("[data-ir-eventos]")) {
        // Desde el buscador: abre el catálogo de eventos y baja hasta él
        e.preventDefault();
        const boton = $("[data-ver-eventos]");
        if (boton && boton.getAttribute("aria-expanded") !== "true") boton.click();
        const campoEv = $("[data-buscar-evento]");
        if (campoEv) { campoEv.value = $("[data-buscador]").value.trim(); filtroEvento = "todas"; buscarEnEventos(); }
        $("#eventos").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        return;
      }
      if (e.target.closest("[data-vaciar]")) { vaciarPedido(); return; }
      if (e.target.closest("[data-deshacer]")) { deshacerVaciado(); return; }
      const ir = e.target.closest("[data-ir-categoria]");
      if (ir) { e.preventDefault(); elegirCategoria(ir.dataset.irCategoria, true); return; }
      if (e.target.closest("[data-abrir-pedido]")) { abrirPedido(); return; }
      if (e.target.closest("[data-cerrar-pedido]")) { cerrarDialogo(hojaPedido); return; }
      if (e.target.closest("[data-nuevo-pedido]")) { nuevoPedido(); }
    });
    [hojaPedido, hojaProducto, gracias].forEach(conectarDialogo);
    conectarDeslizar();
    conectarHojaProducto();

    const form = $("[data-form-pedido]");
    form.addEventListener("change", (e) => {
      if (e.target.name === "modalidad") {
        // Delivery o recojo: las infusiones (solo en el local) salen del pedido, con un aviso
        if (e.target.value !== MOD.reserva) quitarLineasLocal(); else ocultarAvisoLocal();
        pintarTotales();
      }
      if (e.target.name === "saldo") {
        pintarTotales();
        if (e.target.value === "Efectivo") setTimeout(() => form.elements.conCuanto.focus({ preventScroll: true }), 50);
      }
    });
    form.addEventListener("input", (e) => { if (e.target.name === "conCuanto") pintarTotales(); });
    form.addEventListener("keydown", teclaCalendarioPedido);
    form.addEventListener("click", (e) => {
      const dia = e.target.closest("[data-dia-pedido]");
      if (dia) { if (!dia.disabled) elegirDiaPedido(dia.dataset.diaPedido); return; }
      const mes = e.target.closest("[data-mes-pedido]");
      if (mes) { moverMesHorario(Number(mes.dataset.mesPedido)); return; }
      const personas = e.target.closest("[data-personas]");
      if (personas) {
        const campo = form.elements.personas;
        campo.value = Math.min(40, Math.max(1, Number(campo.value || 2) + Number(personas.dataset.personas)));
        $("[data-personas-n]", form).textContent = campo.value;
        $$("[data-personas]", form).forEach((b) => { b.disabled = (b.dataset.personas === "-1" && campo.value <= 1) || (b.dataset.personas === "1" && campo.value >= 40); });
      }
    });
    form.addEventListener("submit", enviarPedido);
    conectarEventos();
    $("[data-promo]")?.addEventListener("click", (e) => {
      if (e.target.closest("[data-promo-cerrar]")) { cerrarTarjetaPromo(); return; }
      const ver = e.target.closest("[data-promo-ver]");
      if (ver) {
        e.preventDefault();
        cerrarTarjetaPromo();
        const cat = categorias.find(esCategoriaPromo);
        if (cat) { elegirCategoria(cat.id, true); history.replaceState(null, "", "#" + cat.id); }
      }
    });
    const cliente = leer(CLAVE_CLIENTE, {});
    ["nombre", "direccion", "referencia"].forEach((c) => { if (cliente[c]) form.elements[c].value = cliente[c]; });

    const buscador = $("[data-buscador]");
    buscador.addEventListener("input", () => { buscar(buscador.value); marcarChip(); });
    $("[data-categorias]").addEventListener("click", (e) => {
      const chip = e.target.closest("[data-chip]");
      if (!chip) return;
      e.preventDefault();
      elegirCategoria(chip.dataset.chip, true);
      history.replaceState(null, "", "#" + chip.dataset.chip);
    });
    actualizarChips = conectarCarrusel($("[data-categorias]"), $$("[data-chips]"), 0.6);
    prepararTodas();
    conectarVistaPrevia();

    window.addEventListener("scroll", revisarFondoBarra, { passive: true });
    window.addEventListener("resize", revisarFondoBarra);

    // Contorno de foco solo con teclado: se marca la modalidad según la última interacción.
    const raizHtml = document.documentElement;
    document.addEventListener("keydown", (e) => { if (e.key === "Tab" || e.key.startsWith("Arrow")) raizHtml.classList.add("con-teclado"); }, true);
    document.addEventListener("pointerdown", () => raizHtml.classList.remove("con-teclado"), true);

    document.addEventListener("error", (e) => {
      const img = e.target;
      if (img.matches && img.matches("img[data-foto]")) {
        img.outerHTML = htmlPronto("claro");
      }
    }, true);

    $("[data-anio]").textContent = new Date().getFullYear();
  }

  /* ---------- inicio ---------- */
  async function iniciar() {
    conectar();
    pintarEstado();
    // La pastilla "Abierto ahora" aparece cuando la barra de horario sale por arriba y se va cuando vuelve
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(([e]) => {
        barraHorarioVisible = e.isIntersecting;
        actualizarPastilla();
        revisarFondoBarra();
      }).observe($(".barra"));
    }
    setInterval(() => (productos.length ? revisarReloj() : pintarEstado()), 30 * 1000);
    prepararCotizacion();
    try {
      const respuesta = await fetch("productos.json", { cache: "no-cache" });
      if (!respuesta.ok) throw new Error(String(respuesta.status));
      datos = await respuesta.json();
      normalizar(datos);
      const vigente = (l) => l && porId.has(l.producto) && l.cantidad > 0 && eleccionExiste(porId.get(l.producto), l.eleccion);
      lineas = (Array.isArray(lineas) ? lineas : []).filter(vigente);
      lineasEvento = (Array.isArray(lineasEvento) ? lineasEvento : []).filter(vigente);
      repintarTodo();
      const idHash = location.hash && decodeURIComponent(location.hash.slice(1));
      if (idHash && idHash.startsWith("c-")) elegirCategoria(idHash, false);
      const destino = idHash && document.getElementById(idHash);
      if (destino) requestAnimationFrame(() => destino.scrollIntoView({ behavior: "auto" }));
      revisarReloj();
      aplicarHoja();
    } catch (error) {
      console.error(error);
      $("[data-carta]").innerHTML = `<p class="carta__cargando">No pudimos cargar la carta. <a href="https://wa.me/${WHATSAPP}" target="_blank" rel="noopener">Escríbenos por WhatsApp</a> y te la enviamos.</p>`;
      $(".vitrina").hidden = true;
    }
  }

  iniciar();
})();
