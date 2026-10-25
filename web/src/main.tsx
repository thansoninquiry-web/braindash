import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import AccessGate from "./components/AccessGate";
import { initTheme } from "./themes";
import "./styles.css";
import "./life.css";
import "./audio.css";
import "./graph.css";

// Apply the saved accent before the first paint so it never flashes orange.
initTheme();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing #root element");

createRoot(rootElement).render(
  <StrictMode>
    {/* The dashboard mounts only once the API says this browser may read it. */}
    <AccessGate>
      <App />
    </AccessGate>
  </StrictMode>,
);
