import { createRoot } from "react-dom/client";
import App from "./App.tsx";

// ✅ MapLibre CSS debe importarse aquí (no en index.css)
import "maplibre-gl/dist/maplibre-gl.css";

import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
