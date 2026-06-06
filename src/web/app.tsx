import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  HashRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { I18nProvider, type Lang, useI18n } from "./i18n/index.tsx";
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
  const handleLogout = () => {
    localStorage.removeItem("console_token");
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-8 max-w-md">
      <h1 className="text-2xl font-bold text-gray-800 mb-4">
        {t("home.title")}
      </h1>
      <p className="text-gray-600 mb-6">{t("home.welcome")}</p>
      <Link
        to="/encrypt"
        className="block w-full bg-blue-500 text-white py-2 rounded-lg text-center hover:bg-blue-600 mb-3"
      >
        {t("home.localEncryption")}
      </Link>
      <Link
        to="/settings"
        className="block w-full bg-gray-500 text-white py-2 rounded-lg text-center hover:bg-gray-600 mb-3"
      >
        {t("home.settings")}
      </Link>
      <Link
        to="/login"
        onClick={handleLogout}
        className="text-gray-500 hover:underline text-sm block text-center"
      >
        {t("home.logout")}
      </Link>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem("console_token");
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
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
          <Route path="/login" element={<Login />} />
          <Route
            path="/home"
            element={
              <ProtectedRoute>
                <Home />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <Settings />
              </ProtectedRoute>
            }
          />
          <Route
            path="/encrypt"
            element={
              <ProtectedRoute>
                <Encrypt />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </HashRouter>
    </I18nProvider>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<AppInner />);
}
