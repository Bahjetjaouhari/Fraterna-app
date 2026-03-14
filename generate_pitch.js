import pptxgen from "pptxgenjs";

const pptx = new pptxgen();
pptx.layout = 'LAYOUT_16x9';

// Define master slide
pptx.defineSlideMaster({
  title: "MASTER_APP",
  background: { color: "0B1221" }, // Deep Navy
  objects: [
    { rect: { x: 0, y: 0, w: "100%", h: "0.1", fill: { color: "E5A91A" } } }, // Gold top line
    { rect: { x: 0, y: "98%", w: "100%", h: "0.2", fill: { color: "E5A91A" } } } // Gold bottom line
  ]
});

// Helper para slides de la App (Imagen a la izquierda, texto a la derecha)
function addAppSlide(title, imageName, usage, posPoints) {
  let slide = pptx.addSlide({ masterName: "MASTER_APP" });
  
  // Imagen (Izquierda)
  slide.addImage({ path: `C:/Users/Bahje/.gemini/antigravity/brain/2aef42c1-b91a-4df6-ab39-815ac0e87c6c/${imageName}`, x: 0.5, y: 0.5, w: 4.8, h: 4.6, sizing: {type: "contain"} });

  // Título
  slide.addText(title, { x: 5.6, y: 0.5, w: 4.2, h: 0.8, fontSize: 32, bold: true, color: "E5A91A" });
  
  // Uso
  slide.addText("💡 ¿CÓMO SE USA Y PARA QUÉ SIRVE?", { x: 5.6, y: 1.5, w: 4.2, h: 0.4, fontSize: 13, color: "A0AABF", bold: true });
  slide.addText(usage, { x: 5.6, y: 1.9, w: 4.2, h: 1.2, fontSize: 15, color: "FFFFFF" });
  
  // Puntos positivos
  slide.addText("✅ PUNTOS POSITIVOS", { x: 5.6, y: 3.3, w: 4.2, h: 0.4, fontSize: 13, color: "A0AABF", bold: true });
  let formattedPoints = posPoints.map(b => ({ text: b + "", options: { fontSize: 14, color: "E5A91A", bullet: true } }));
  slide.addText(formattedPoints, { x: 5.6, y: 3.7, w: 4.2, h: 1.5 });
}

// 1. Splash / Portada
let slideCover = pptx.addSlide({ masterName: "MASTER_APP" });
slideCover.addText("FRATERNA APP", { x: 1, y: 2, w: 8, h: 1, fontSize: 60, bold: true, color: "E5A91A", align: "center", fontFace: "Arial" });
slideCover.addText("Conectando con Tecnología de Vanguardia", { x: 1, y: 3.2, w: 8, h: 1, fontSize: 24, color: "FFFFFF", align: "center" });
slideCover.addText("Presentación Oficial de Funcionalidades", { x: 1, y: 4, w: 8, h: 0.5, fontSize: 18, color: "A0AABF", align: "center", italic: true });

// 2. Registro (media__1773280683813.png)
addAppSlide(
  "Página de Registro", 
  "media__1773280683813.png", 
  "El usuario introduce sus datos básicos y datos masónicos (logia, país, etc.) para crear la cuenta y ser sometido al proceso de validación por reteje.",
  [
    "Registro completo para evitar perfiles anónimos o bots.",
    "Formulario rápido, claro e intuitivo.",
    "Diseño oscuro (Dark mode) elegante y moderno, fácil de leer."
  ]
);

// 3. Mapa Interactivo (media__1773280770377.png)
addAppSlide(
  "Radar Fraternal (Mapa)", 
  "media__1773280770377.png", 
  "La pantalla central. Es el mapa georreferenciado en 2D interactivo donde puedes ver a tus Hermanos de forma discreta a tu alrededor y chatear.",
  [
    "Fomenta interacciones reales y networking instantáneo.",
    "Ubicación ofuscada para proteger el hogar / punto exacto.",
    "Alta velocidad de carga e interfaz orientada al usuario directo."
  ]
);

// 4. Panel de Amigos (media__1773280806092.png)
addAppSlide(
  "Directorio de Amigos", 
  "media__1773280806092.png", 
  "Aquí puedes buscar a otros usuarios registrados por nombre/email y agregarlos o removerlos de tu lista de amigos y contactos confiables.",
  [
    "Crea círculos y redes de contacto privados 100% reales.",
    "Búsqueda instantánea en base de datos segura.",
    "Permite separar las interacciones globales de las más intimas."
  ]
);

// 5. Privacidad General (media__1773280828896.png)
addAppSlide(
  "Control Total: Privacidad", 
  "media__1773280828896.png", 
  "El núcleo de Fraterna. Configuraciones para activar/desactivar tu aparición en el mapa mediante un switch o activar tu 'Modo Fantasma'.",
  [
    "Pone el poder de decisión totalmente en manos del usuario.",
    "Modo fantasma congela tracking y oculta la ubicación de inmediato.",
    "Otras apps exponen ubicaciones 24/7; Fraterna cuida al usuario."
  ]
);

// 6. Alertas / Cercanía (media__1773280887118.png)
addAppSlide(
  "Notificaciones Personalizadas", 
  "media__1773280887118.png", 
  "Menú para configurar el perímetro (ej. de 1 km a 25 km). Te notifica si alguien cruzó tu radio, permitiendo la interacción asíncrona.",
  [
    "No es necesario tener la app abierta para generar conexión.",
    "Excelente herramienta para viajar (ayuda masónica o socorro).",
    "Adaptabilidad fina del rango de detección según tu geografía."
  ]
);

// Final Slide
let slideLast = pptx.addSlide({ masterName: "MASTER_APP" });
slideLast.addText("FRATERNA Nos Une", { x: 1, y: 2, w: 8, h: 1, fontSize: 48, bold: true, color: "E5A91A", align: "center" });
slideLast.addText("Un paso tecnológico hacia el futuro.", { x: 1, y: 3, w: 8, h: 1, fontSize: 24, color: "FFFFFF", align: "center", italic: true });

const filePath = "C:/Users/Bahje/OneDrive/Desktop/Antigravity Fraterna/Fraterna Lovable/Presentacion_Oficial_Fraterna.pptx";
pptx.writeFile({ fileName: filePath }).then(fileName => {
    console.log(`¡Presentacion Final (con app) creada en: ${fileName}!`);
}).catch(err => {
    console.error("Error: ", err);
});
