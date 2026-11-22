# FocusSync · Landing Page responsive

Demo académica del curso **HCI for UX Design (1ASI0784, UPC, ciclo 2026-20)**. Equipo CogniFlow Systems, Grupo 5.
FocusSync es una interfaz adaptativa que ayuda a estudiantes universitarios a reducir la sobrecarga cognitiva con
sugerencias sutiles, voluntarias y **100 % locales**. Esta landing implementa **30 Historias de Usuario core**.

## Estructura del repositorio

```
landing-page-solucion/
├── index.html              Redirige a pages/index.html (necesario para GitHub Pages)
├── favicon.ico
├── .gitignore
├── assets/                 images/, icons/, fonts/, videos/ (la demo usa SVG en línea y fuentes del sistema)
├── css/styles.css          Estilos responsive (escritorio, tablet, móvil) y accesibles
├── js/main.js              Toda la lógica de la demo
├── pages/index.html        Landing page
└── docs/
    ├── README.md
    ├── capturas/           Capturas de evidencia (escritorio, tablet, móvil)
    └── tests/              Pruebas de aceptación automatizadas y sus resultados
```

## Ejecutar en local

No requiere instalación: abre `pages/index.html` en el navegador, o sirve la carpeta con cualquier servidor estático
(`python3 -m http.server`) y entra a `http://localhost:8000/`.

## Publicar en GitHub Pages

1. Crea un repositorio público y sube **el contenido de esta carpeta** (que `index.html` quede en la raíz).
2. En GitHub: **Settings, Pages, Build and deployment, Deploy from a branch**, rama `main`, carpeta `/ (root)`.
3. Espera 1 o 2 minutos. La URL será `https://USUARIO.github.io/REPOSITORIO/`.
4. Abre la URL en escritorio y en tu celular, y repite las pruebas de aceptación sobre esa URL (ver más abajo).

## Pruebas de aceptación

```
cd docs/tests
npm install
BASE_URL=https://USUARIO.github.io/REPOSITORIO/pages/index.html node acceptance.test.js
```

Genera `docs/tests/results/resultados.json` y `resultados.md` con el formato del handbook
(ID prueba, HU, criterio, acción, resultado esperado, resultado obtenido, estado).
Sin `BASE_URL` prueba el archivo local.

## Cómo probar los tiempos largos

La demo usa tiempos reales (60 s de recálculo, 15 s de desvanecimiento, 60 s de respiración, etc.).
Para pruebas existe el parámetro `?timescale=N`, que acelera el reloj interno N veces
(por ejemplo `pages/index.html?timescale=30`). También hay botones de simulación en la sección *Monitoreo*.

## Atajos de teclado

| Atajo | Acción |
|---|---|
| Ctrl + Shift + Z | Activar o salir del Modo Zen |
| Alt + Shift + F | Vista de tarea única |
| Ctrl + J | Abrir o cerrar Brain Dump |
| Esc | Cerrar Brain Dump, saltar la pausa o salir del Modo Zen |

## Privacidad por diseño

- Todo se procesa en la memoria del navegador. No hay servidor, cuentas ni envíos.
- La página declara una política CSP con `connect-src 'none'`: el navegador bloquea cualquier envío de datos.
- Se escuchan eventos `input` solo para leer si la entrada fue inserción o borrado; **nunca se lee ni guarda la tecla ni el texto**.
- Los atajos solo reconocen combinaciones con Ctrl o Alt y la tecla Esc; el resto de teclas se ignora.
- Se guardan únicamente agregados (minutos, ánimo, preferencias) y las notas que la persona escribe a propósito en Brain Dump.
  Todo se borra con el botón *Borrar todos mis datos de estudio*.

## Alcance y limitaciones

- Un navegador no puede observar otras aplicaciones. La demo mide solo lo que ocurre dentro de la página;
  las "ventanas" son cambios de pestaña o de foco.
- La atenuación lumínica se aplica sobre la página, no sobre todo el sistema operativo.
- Los datos de ejemplo del gráfico de bienestar son ilustrativos y se eliminan con el borrado total.

## Historias de Usuario implementadas (30)

| HU | Nombre | Dónde se ve |
|---|---|---|
| HU-001 | Registro pasivo del tiempo continuo en pantalla | #demo (panel de estado) |
| HU-002 | Detección pasiva de vacilaciones en el cursor del ratón | #demo (dispersión del cursor) |
| HU-003 | Identificación de patrones de tecleo errático bajo estrés | #demo (borrado al teclear) |
| HU-004 | Reconocimiento de cambios compulsivos entre ventanas | #demo (cambios de pestaña) |
| HU-006 | Cálculo del índice contextual de sobrecarga cognitiva | #demo (nivel e índice) |
| HU-007 | Ajuste de la sensibilidad de detección periférica | #demo (slider de sensibilidad) |
| HU-009 | Activación manual del Modo Zen | Barra superior y #zen |
| HU-010 | Sugerencia sutil de activación del Modo Zen ante sobrecarga | Sugerencia flotante |
| HU-011 | Atenuación adaptativa de la luminiscencia y contraste | #zen (atenuación) |
| HU-012 | Ocultación de elementos y barras periféricas en pantalla | Modo Zen (repliegue de periféricos) |
| HU-014 | Conmutador de vista de tarea única (Single-Task Focus) | #demo (Vista de tarea única) |
| HU-016 | Desactivación inmediata y retorno al estado normal | Barra del Modo Zen (Salir) |
| HU-017 | Sugerencia no invasiva de micro-pausa de autorregulación | Sugerencia flotante de pausa |
| HU-018 | Guía interactiva de respiración diafragmática de 60 segundos | Diálogo de respiración |
| HU-020 | Guardado contextual de la posición de trabajo (Task Marker) | Botón Volver a mi tarea pendiente |
| HU-021 | Cancelación voluntaria de la micro-pausa en curso | Botón Saltar ejercicio |
| HU-024 | Mensajes empáticos de validación y refuerzo positivo | Mensaje de refuerzo tras la pausa |
| HU-026 | Fraccionamiento de entregables extensos en micro-hitos | #organizacion (micro-hitos) |
| HU-028 | Temporizador flexible de sesión sin cortes forzosos | #organizacion (temporizador) |
| HU-031 | Registro de notas rápidas de despeje mental (Brain Dump) | Brain Dump (Ctrl+J) |
| HU-035 | Visualización del tiempo productivo frente al tiempo de pausa | #bienestar (gráfico) |
| HU-036 | Registro cualitativo de estado de ánimo post-sesión | #bienestar (cerrar jornada) |
| HU-037 | Resumen de micro-pausas y ejercicios de respiración completados | #bienestar (resumen) |
| HU-043 | Procesamiento local de patrones de teclado y ratón | Chip y contador de red |
| HU-044 | Garantía de cero registro de texto (Anti-Keylogger) | Manifiesto e inspector de datos |
| HU-045 | Eliminación instantánea del historial de interacción | #privacidad (borrado total) |
| HU-046 | Control de activación y desactivación de la detección pasiva | Interruptor de monitoreo |
| HU-047 | Configuración de no intrusión en evaluaciones en línea | #privacidad (Modo Examen) |
| HU-048 | Garantía de ausencia de fiscalización para tutores y docentes | #privacidad (compromiso ético) |
| HU-049 | Ajuste de frecuencia de recordatorios y descansos | Selector de frecuencia |

## Créditos

Equipo: Barazorda Loayza, Cano Aranda, Castillo De La Cruz, Gutierrez Gonzales, Heras Yauri y Ventocilla Huamancha.
Docente: Kevin Edgar Salazar Ruiz. Universidad Peruana de Ciencias Aplicadas.
