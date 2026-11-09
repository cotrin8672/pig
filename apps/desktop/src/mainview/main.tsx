import { createRoot } from "react-dom/client";
import { App } from "./App";
import "katex/dist/katex.min.css";
import "./styles.css";

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
