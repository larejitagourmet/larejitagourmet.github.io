# Cómo actualizar la web de La Rejita Gourmet

Hay dos lugares para actualizar:

| Qué quieres cambiar | Dónde |
|---|---|
| Precios, descripciones, qué postres de vitrina hay hoy, la frase de la semana | **Google Sheets** (desde el celular, sin tocar código) |
| Productos nuevos, opciones, fotos, "Los más pedidos" | **`productos.json`** en GitHub |

La web siempre arranca con los datos de `productos.json` y luego aplica lo que diga la hoja. Si la hoja no carga en 4 segundos o un dato está mal escrito, se queda con lo de `productos.json` y oculta la frase. La web nunca se rompe por un error en la hoja.

---

## 1. La hoja de Google

La hoja **La Rejita – carta** ya está creada, publicada y conectada a la web. Tiene dos pestañas:

- **Productos:** una fila por precio, sabor o adicional, con las columnas `id | nombre | tipo | precio | disponible | descripcion`.
- **Frase:** `frase` en A1 y la frase de la semana en A2.

**Atajo diario:** abre la vista de filtro **Vitrina del día** desde **Data → Filter views → Vitrina del día**, o guarda en favoritos su enlace directo, el que termina en `&fvid=369803442`.

**Enlaces publicados** (ya están en `productos.json`, en `config.hoja`):
- Productos: `…/pub?gid=0&single=true&output=csv`
- Frase: `…/pub?gid=1586443138&single=true&output=csv`

**Importante:**
- "Publish to web" hace públicos **solo los datos de esas dos pestañas**. Para editar, la hoja sigue siendo privada.
- No agregues costos, stock ni nada interno a estas pestañas. Si necesitas eso, ponlo en otra hoja aparte.

### Si algún día hay que rehacerla

Tu Google Sheets está en inglés, así que los menús van en inglés.

1. **Importar:**
   - Ve a **File → Import → Upload** y elige `hoja-inicial.csv`.
   - Marca **Import location: Replace current sheet** y **Separator type: Comma**, y deja marcado **Convert text to numbers, dates, and formulas**.
   - Pulsa **Import data**.
   - Para regenerar `hoja-inicial.csv` con la carta actual, pídeselo a Claude.
2. **Pestaña:** haz doble clic en su nombre y escribe **Productos**. Luego **View → Freeze → 1 row** fija los títulos.
3. **Casillas:** selecciona **E2:E185** y ve a **Insert → Checkbox**.
4. **Lista de tipos:**
   - Selecciona **C2:C500** y ve a **Data → Data validation → Add rule**.
   - En **Criteria** elige **Dropdown**, con las opciones `vitrina`, `siempre disponible`, `por encargo`, `evento` y `adicional`.
   - En **Advanced options**, marca **Reject the input**.
5. **Precios:**
   - Selecciona **D2:D500** y ve a **Data → Data validation → Add rule**.
   - Elige **Greater than** `0`, marca **Reject the input** y como texto de ayuda escribe *Solo el número, sin S/. Ejemplo: 8 o 22.5*.
   - Luego ve a **Format → Number → Number**.
6. **Vista de filtro:**
   - Ve a **Data → Filter views → Create new filter view** y ponle de nombre **Vitrina del día**.
   - En la columna C, pulsa **Filter by values**, luego **Clear**, marca solo `vitrina` y pulsa **OK**.
7. **Frase:**
   - Pulsa **+** (Add Sheet) y llama a la pestaña **Frase**. Escribe `frase` en A1 y tu frase en A2.
   - Opcional: en **Data validation**, elige **Custom formula is** `=LEN(A2)<=280`.
8. **Publicar:**
   - Ve a **File → Share → Publish to web**, elige **Productos** y **Comma-separated values (.csv)**, y pulsa **Publish**.
   - Repite con **Frase**.
   - En **Published content & settings**, deja marcado **Automatically republish when changes are made**.
9. **Conectar:** pon los dos enlaces nuevos en `productos.json`, en `config.hoja.productosCsv` y `config.hoja.fraseCsv`.

---

## 2. Uso diario de la hoja

- **Se acabó algo de vitrina** (postres del día): desmarca su casilla en **disponible**.
  - En la web aparecerá como *"Hoy se acabó · pídelo para mañana"*.
  - El cliente puede agregarlo marcado "para otro día", y la web le sugiere uno parecido que sí haya.
  - Al día siguiente vuelve a marcar la casilla.
- **Hoy no hay algo de la carta** (siempre disponible o por encargo, por ejemplo se acabó el tocino): desmarca su casilla en **disponible**.
  - En la web aparecerá como *"No disponible hoy"*, sin botón para pedirlo.
  - Si un cliente ya lo tenía en su pedido, la web se lo quita y le avisa al abrir "Tu pedido".
  - Cuando vuelva a haber, marca la casilla otra vez.
- **La disponibilidad va por fila:** cada sabor, tamaño u opción tiene su propia fila (por ejemplo `jugo-con-leche`). Si desmarcas solo esa fila, solo esa opción sale "No disponible hoy" en el panel y las demás se pueden pedir.
- **Cambiar un precio:** escribe solo el número en **precio**, por ejemplo `8` o `22.5`. Sin "S/".
- **Cambiar la frase:** edita la celda **A2** de la pestaña **Frase**.
- **Cambiar una descripción:** escribe en la columna **descripcion**, en la primera fila del producto.
- **Cambiar el tipo de un producto:** elige el nuevo tipo en la columna **tipo**, en todas las filas de ese producto. La web usa la primera fila.
- **Cuándo se ve el cambio:** Google tarda **unos 5 minutos** en mostrar los cambios publicados. Después de eso, recarga la web.

**Los tipos de producto:**

| Tipo | Dónde aparece | Si desmarcas **disponible** | Ejemplos |
|---|---|---|---|
| `siempre disponible` | En la carta. Se prepara al momento. | Sale **"No disponible hoy"** y no se puede pedir. | Hamburguesas, alitas, jugos, tragos |
| `vitrina` | En la carta, como postre del día. | Sale **"Hoy se acabó · pídelo para mañana"** y se puede pedir "para otro día". En **Temporada**, si desmarcas todo, la sección desaparece de la web. | Cheesecake, muffins, cuchareables, turrón |
| `por encargo` | En la carta, con el aviso "Por encargo · con X días de anticipación". El cliente elige el día al pedir. | Sale **"No disponible hoy"** y no se puede pedir. | Tortas familiares, cupcake personalizado, box desayuno |
| `evento` | **No sale en la carta.** Solo en "¿Se viene una celebración?" → **Ver opciones para tu evento 🎉**. El cliente lo agrega a "Elegiste" y pide la cotización por WhatsApp. | **No se muestra** en el catálogo de eventos. Si desmarcas solo una cantidad (por ejemplo `boc-tequenos-100`), esa cantidad desaparece del panel. | Servicios (Decoración y Otro pedido especial), tortas para eventos y bocaditos (salados, dulces y calientes) |
| `adicional` | Dentro del panel de opciones de un producto (papas, velas, frozen…). | Nada: la web ignora la casilla. | Porción de papas, velas, topper, frozen |

> **Ojo:** si en la hoja ningún producto tiene tipo `evento`, el botón "Ver opciones para tu evento" no aparece y esos productos salen en la carta (la hoja manda sobre `productos.json`).

- Si una categoría se queda sin productos en la carta, desaparece sola de la lista de categorías.
- Para pasar un producto de la carta a eventos, o al revés, solo cambia su **tipo** en todas sus filas.

**Qué significa cada columna:**

| Columna | Para qué sirve |
|---|---|
| **id** | La clave que une la fila con la web. **No la cambies.** |
| **nombre** | Solo para que sepas qué fila es. La web usa los nombres de `productos.json`. |
| **tipo** | `vitrina`, `siempre disponible`, `por encargo`, `evento` o `adicional` (ver la tabla de arriba). La web toma el tipo de un producto de **su primera fila**; si está vacío o mal escrito, usa el de `productos.json`. Cambia todas las filas del producto para que la vista "Vitrina del día" las muestre juntas. |
| **precio** | El precio en soles, solo el número. **Vacío** = la web lo muestra como "a cotizar" (no suma al total). Cuando escribas el precio, la web lo usa. |
| **disponible** | Funciona en todo: `siempre disponible`, `vitrina`, `por encargo` y `evento` (ver la tabla de arriba). En `adicional` la web ignora la casilla. |
| **descripcion** | La descripción corta del producto. Va **solo en la primera fila de cada producto** (por ejemplo, la de alitas va en `alitas-x6`; las demás filas de alitas quedan vacías). Si la dejas vacía, la web usa la de `productos.json`. Máximo 300 caracteres. |

**Filas especiales:**
- `alitas-mixtas-x6` y `alitas-mixtas-x8`: es el precio cuando el cliente mezcla 2 sabores.
- Turrón: cada tamaño tiene su fila con su propio precio (`turron-porcion`, `turron-400g`, `turron-600g`, `turron-900g`).
- `torta-tematica`: es el precio "desde" que se muestra.
- **Bocaditos para eventos** (`boc-…`): una fila por cantidad, por ejemplo `boc-tequenos-50` y `boc-tequenos-100`. El nombre empieza con "Bocadito salado", "Bocadito dulce" o "Bocadito caliente" para que los encuentres fácil.
  - Precio vacío y **disponible** marcado: esa cantidad sale "a cotizar".
  - **Disponible** desmarcado en todas sus filas: el bocadito no se muestra. Así están los que todavía no confirmas (canapés, trufas, butifarritas, etc.): cuando confirmes, escribe sus precios y marca sus casillas.
- `jugo`: precio de todos los jugos con agua. `jugo-con-leche` y `jugo-deslactosada` son solo para el jugo de fresa.
- `frozen-adicional`: lo que se suma cuando el cliente pide un jugo o una limonada **frozen** (hoy S/ 3).
- `infusion`: precio de la infusión (un solo producto; el cliente elige el sabor en el panel: anís, manzanilla, hierba luisa o té). Es **solo para tomar en el local**: se pide únicamente como "Reserva en el local".
- `filtrante-adicional`: lo que se suma si el cliente pide un filtrante extra en su infusión (hoy S/ 1).
- Las filas con tipo `adicional` son los adicionales (papas, ensalada, velas, topper, frozen…).

**Reglas que no están en la hoja** (se cambian en `productos.json`, en `config`):
- `config.pedido`: tiempo mínimo de preparación (`minutosMinimos`: 40), tiempo estimado del delivery (`deliveryEstimado`: "45–60 min"), última hora para recojo (`ultimaHoraRecojo`: "22:45") y para reserva (`ultimaHoraReserva`: "22:00"), y el adelanto de las reservas (`adelantoReserva`: 0.7 = 70%).
- `config.promo2x1`: la categoría (`"Tragos"`) y el horario de la promo (`desde`: "19:00", `hasta`: "22:00"). Aplica de martes a domingo, en delivery, recojo y reserva.
- **Probar la promo fuera de horario:** abre la web con `?probar2x1` al final de la dirección (por ejemplo `https://…/?probar2x1` o `http://localhost:8080/?probar2x1`). La promo queda activa a cualquier hora, el aviso dice "Modo de prueba" y el mensaje de WhatsApp empieza con "[PRUEBA DE LA PROMO 2x1: no preparar]". El aviso sale una vez por visita: para volver a verlo, abre la dirección en una pestaña nueva.

### Temporada (prender y apagar)

La sección **Temporada** sale arriba de la carta, aparte, solo cuando tiene algo disponible. Hoy tiene el turrón.

- **Apagarla:** desmarca **disponible** en **todas** las filas de sus productos (por ejemplo `turron-porcion`, `turron-400g`, `turron-600g` y `turron-900g`). La sección completa desaparece de la web, sin mostrar "Hoy se acabó".
- **Prenderla:** vuelve a marcar **disponible** en las filas que tengas. Con una sola fila marcada, la sección aparece con esa opción.
- **Apagar solo un tamaño:** desmarca solo esa fila. La sección sigue y ese tamaño sale "Hoy se acabó" en el panel.
- **Producto de temporada nuevo** (por ejemplo, panetón en diciembre):
  1. En `productos.json`, copia el bloque del turrón y cambia `"id"` (por ejemplo `"paneton"`), `"nombre"`, `"descripcion"` y `"foto"`. Deja `"categoria": "Temporada"`.
  2. Si tiene tamaños, cambia sus `"opciones"` y `"precios"`. Cada precio necesita un `"id"` propio (por ejemplo `paneton-1kg`). Si tiene un solo precio, usa `"precio": 35` en lugar de `"opciones"` y `"precios"`.
  3. En la hoja, agrega una fila por cada id de precio, con tipo `vitrina`, el precio y **disponible** marcado.
  4. Si hay más de un producto de temporada a la vez, la sección los muestra juntos con el título "Llegó la temporada".

---

## 3. Editar `productos.json` (estructura)

Edítalo en GitHub: abre el archivo, pulsa el lápiz ✏️, cambia y pulsa **Commit changes**. Respeta las comillas y las comas. Si algo queda mal escrito, la web muestra "No pudimos cargar la carta".

- **Descripción de base:** el texto de `"descripcion": ""` se usa cuando la columna **descripcion** de la hoja está vacía. Lo normal es editar las descripciones desde la hoja.
- **Foto de un producto:**
  - Prepara la foto: recórtala para que el producto llene el marco y sin la marca de agua del logo, de unos 1200 px de ancho, en `.jpg` y de menos de 300 KB. Si quieres, pídeselo a Claude.
  - Súbela a la carpeta `assets/img/productos/` con nombre en minúsculas, sin tildes ni espacios. Ejemplo: `assets/img/productos/cheesecake-de-fresa.jpg`.
  - Agrega `"foto": "assets/img/productos/cheesecake-de-fresa.jpg"` al producto.
  - Si es la foto de un sabor, ponla dentro de ese sabor, en `"valores"`.
  - Cada sabor muestra solo su propia foto. Un sabor sin foto muestra a Misifu con "Pronto su foto", aunque otro sabor del mismo producto sí tenga foto. Al mezclar dos sabores (alitas) se muestra la foto del primer sabor elegido, si la tiene; si no, Misifu.
- **Los más pedidos:** se editan en la lista `"masPedidos"`. Ahí van el producto, el sabor u opción ya elegido y el nombre que se muestra.
- **Días de anticipación:**
  - Se definen por categoría: `"anticipacion": 7` en Tortas y postres familiares, `10` en eventos y bocaditos y `2` en Boxes y regalos.
  - Boxes y regalos además tiene `"anticipacionMax": 7`: el calendario deja elegir desde 2 días, la web avisa que un modelo elaborado puede tomar hasta 7 y en WhatsApp la fecha va "sujeta a confirmación".
  - También se puede poner en un producto puntual, como el cupcake personalizado.
- **Productos personalizables** (`"personalizable": true` en `productos.json`): si el cliente elige uno, "Cuéntanos tu idea" pasa a ser obligatoria al cotizar. Hoy lo son la torta temática, la mini torta personalizada de 4 porciones, Decoración y Otro pedido especial.
- **Solo en el local:** un producto con `"soloLocal": true` (las infusiones) muestra la etiqueta "Solo en el local" y solo se puede pedir en "Reserva en el local". Si el cliente elige delivery o recojo, la web lo quita del pedido con un aviso y le ofrece volver a la reserva.
- **Tipo de disponibilidad:**
  - Se define por categoría con `"tipo"`: `"siempre"`, `"vitrina"`, `"encargo"` o `"evento"`.
  - Un producto puede tener su propio `"tipo"`. Lo que diga la hoja manda sobre esto.
  - Una categoría con `"destacada": true` (Temporada) no va en la carta: sale como sección aparte, solo cuando tiene algo disponible.
- **Frozen:** un jugo o limonada con `"bebida": { "frozen": true }` muestra la opción "Frozen". Su precio es el de la fila `frozen-adicional`.
- **Producto nuevo:** copia uno parecido, cambia el `id` (en minúsculas y con guiones) y agrega su fila en la hoja con el mismo id.

Si cambias o agregas un precio en `productos.json`, agrega también la fila en la hoja. Si una fila no existe en la hoja, se usa el precio de `productos.json`.
