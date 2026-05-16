import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { AppUpdateProvider } from "./appUpdate.tsx";
import { seedDefaultCategories } from "./db/index.ts";
import "./index.css";

seedDefaultCategories();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppUpdateProvider>
      <App />
    </AppUpdateProvider>
  </StrictMode>
);
