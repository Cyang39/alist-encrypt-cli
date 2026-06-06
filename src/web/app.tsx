import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { I18nProvider, type Lang, useI18n } from "./i18n/index.tsx";
import AppLayout from "./layouts/AppLayout.tsx";
import AuthLayout from "./layouts/AuthLayout.tsx";
import Encrypt from "./pages/Encrypt.js";
import Settings from "./pages/Settings.js";

function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const { t } = useI18n();

  const handleLogin = async () => {
    setError("");
    try {
      const resp = await fetch("/@console/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await resp.json();
      if (data.success) {
        localStorage.setItem("console_token", data.token);
        navigate("/home");
      } else {
        setError(data.message || t("login.failed"));
      }
    } catch {
      setError(t("common.networkError"));
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-8 max-w-md">
      <h1 className="text-2xl font-bold text-gray-800 mb-4">
        {t("login.title")}
      </h1>
      <input
        type="password"
        placeholder={t("login.placeholder")}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleLogin()}
        className="w-full px-4 py-2 border rounded-lg mb-4"
      />
      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
      <button
        type="button"
        onClick={handleLogin}
        className="w-full bg-blue-500 text-white py-2 rounded-lg hover:bg-blue-600"
      >
        {t("login.button")}
      </button>
    </div>
  );
}

function Home() {
  const { t } = useI18n();

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-800 mb-4">
        {t("home.title")}
      </h1>
      <p className="text-gray-600">{t("home.welcome")}</p>
    </div>
  );
}

function AppInner() {
  const savedLang = (localStorage.getItem("console_lang") as Lang) || "en";
  const [lang, setLang] = useState<Lang>(savedLang);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/@console/api/lang")
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.lang) {
          setLang(data.lang as Lang);
          localStorage.setItem("console_lang", data.lang);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const handleLangChange = (newLang: Lang) => {
    setLang(newLang);
    localStorage.setItem("console_lang", newLang);
    fetch("/@console/api/lang", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${localStorage.getItem("console_token") ?? ""}`,
      },
      body: JSON.stringify({ lang: newLang }),
    }).catch(() => {});
  };

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <I18nProvider defaultLang={lang} onLangChange={handleLangChange}>
      <HashRouter>
        <Routes>
          {/* Auth routes */}
          <Route element={<AuthLayout />}>
            <Route path="/login" element={<Login />} />
          </Route>

          {/* App routes with sidebar */}
          <Route element={<AppLayout />}>
            <Route path="/home" element={<Home />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/encrypt" element={<Encrypt />} />
          </Route>

          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </HashRouter>
    </I18nProvider>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<AppInner />);
}
