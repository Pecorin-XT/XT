# Peco-XT

Extensión gratuita y de código abierto para Opera y navegadores Chromium. Peco-XT ayuda a analizar preguntas en páginas compatibles con Gemini, ChatGPT y DeepSeek, resaltar opciones y practicar con cuestionarios.

> **Compatibilidad con Instructure/Canvas:** por ahora, Peco-XT funciona con algunos componentes de los formularios de Instructure (Canvas LMS). La compatibilidad es parcial: puede variar según el tipo de pregunta y la configuración del formulario. No significa que todos los componentes o cursos de Canvas estén soportados.

<p>
  <img src="./store-assets/instructure-canvas-logo.png" alt="Canvas by Instructure" width="260">
</p>

Peco-XT es un proyecto independiente y no está afiliado, patrocinado ni respaldado por Instructure.

## Funciones

- Conecta Gemini API con tus propias claves, o usa Gemini, ChatGPT y DeepSeek en el navegador con tu sesión iniciada.
- Analiza preguntas y resalta opciones en páginas compatibles.
- Ajusta la apariencia de los resaltados y el estilo de respuesta.
- Incluye una guía y un laboratorio de práctica.

La extensión no proporciona cuentas, suscripciones ni claves de IA. Todas las funciones están disponibles sin licencias ni compras.

## Instalar en Opera

No necesitas instalar herramientas ni compilar la extensión. Descarga el [ZIP listo para instalar](https://github.com/Pecorin-XT/XT/raw/refs/heads/main/released/Peco-XT-Opera-v1.1.2.zip) y extráelo. Después:

1. Abre `opera://extensions`.
2. Activa el **Modo de desarrollador**.
3. Selecciona **Cargar extensión sin empaquetar** y elige la carpeta extraída donde está `manifest.json`.

Peco-XT se entrega como código fuente JavaScript normal: no requiere un paso de build ni dependencias externas.

También puedes descargar el código fuente completo con el botón **Code → Download ZIP** de GitHub.

## Estructura del proyecto

- `background/`: service worker y conexiones con proveedores.
- `content/`: integración con las páginas y formularios compatibles.
- `popup/`: ventana de configuración de la extensión.
- `guide/`: guía de uso y laboratorio de práctica.
- `icons/`: iconos de la extensión y proveedores.
- `store-assets/`: recursos gráficos para el README y la ficha de la tienda.
- `manifest.json`: permisos, puntos de entrada y configuración de la extensión.

## Privacidad

Cuando solicitas un análisis, el contenido de la pregunta se envía al proveedor de IA que hayas seleccionado. El sitio web de Peco-XT no recibe tus preguntas, respuestas ni claves API. Consulta la [política de privacidad](https://pecorin-xt.onrender.com/privacy/).

No agregues claves API, contraseñas ni claves privadas `.pem` al repositorio. Los paquetes CRX, las claves PEM y los ZIP están excluidos intencionalmente.

## Licencia

Peco-XT se distribuye bajo la licencia [MIT](./LICENSE).

## Marcas de terceros

Instructure, Canvas, Gemini, ChatGPT y DeepSeek son marcas o servicios de sus respectivos propietarios. Peco-XT es independiente y no está afiliada a esos proveedores.
