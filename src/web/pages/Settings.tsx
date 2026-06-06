import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { type Lang, useI18n } from "../i18n/index.tsx";

interface PasswdInfo {
  password: string;
  describe: string;
  encType: string;
  enable: boolean;
  encName: boolean;
  encSuffix: string;
  encPath: string[];
}

interface AlistServer {
  name: string;
  path: string;
  describe: string;
  serverHost: string;
  serverPort: number;
  https: boolean;
  passwdList: PasswdInfo[];
}

interface WebdavServer {
  id: string;
  name: string;
  path: string;
  describe: string;
  enable: boolean;
  serverHost: string;
  serverPort: number;
  https: boolean;
  passwdList: PasswdInfo[];
}

interface ServerConfig {
  port: number;
  logFile?: boolean;
  password?: string;
  jwtSecret?: string;
  jwtExpiresIn?: string;
  web?: { lang?: string };
  alistServer: AlistServer;
  webdavServer: WebdavServer[];
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("console_token");
  return {
    "content-type": "application/json",
    authorization: token ? `Bearer ${token}` : "",
  };
}

function newPasswdInfo(): PasswdInfo {
  return {
    password: "",
    describe: "",
    encType: "aesctr",
    enable: true,
    encName: false,
    encSuffix: "",
    encPath: [],
  };
}

function newWebdavServer(): WebdavServer {
  return {
    id: crypto.randomUUID(),
    name: "",
    path: "/*",
    describe: "",
    enable: true,
    serverHost: "",
    serverPort: 5244,
    https: false,
    passwdList: [newPasswdInfo()],
  };
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <h2 className="text-lg font-semibold text-gray-800 mb-4 border-b pb-2">
        {title}
      </h2>
      {children}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <div className="text-sm font-medium text-gray-700 mb-1">{label}</div>
      {children}
    </div>
  );
}

function Input({
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
    />
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? "bg-blue-500" : "bg-gray-300"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function PasswdInfoForm({
  info,
  index,
  onChange,
  onRemove,
}: {
  info: PasswdInfo;
  index: number;
  onChange: (i: number, v: PasswdInfo) => void;
  onRemove: (i: number) => void;
}) {
  const { t } = useI18n();
  const update = (field: keyof PasswdInfo, value: unknown) => {
    onChange(index, { ...info, [field]: value });
  };

  return (
    <div className="border rounded-lg p-4 mb-3 bg-gray-50">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-600">
          {t("passwd.rule", { index: index + 1 })}
        </span>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">{t("passwd.enabled")}</span>
            <Toggle
              checked={info.enable}
              onChange={(v) => update("enable", v)}
            />
          </div>
          <button
            type="button"
            onClick={() => onRemove(index)}
            className="text-red-500 hover:text-red-700 text-sm"
          >
            {t("passwd.remove")}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("passwd.password")}>
          <Input
            value={info.password}
            onChange={(v) => update("password", v)}
            placeholder={t("passwd.passwordPlaceholder")}
          />
        </Field>
        <Field label={t("passwd.description")}>
          <Input
            value={info.describe}
            onChange={(v) => update("describe", v)}
            placeholder={t("passwd.descriptionPlaceholder")}
          />
        </Field>
        <Field label={t("passwd.algorithm")}>
          <select
            value={info.encType}
            onChange={(e) => update("encType", e.target.value)}
            className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            <option value="aesctr">AES-128-CTR</option>
            <option value="rc4">RC4-MD5</option>
            <option value="mix">MixEnc</option>
          </select>
        </Field>
        <Field label={t("passwd.encFilename")}>
          <div className="flex items-center gap-2 h-[38px]">
            <Toggle
              checked={info.encName}
              onChange={(v) => update("encName", v)}
            />
            <span className="text-xs text-gray-500">
              {info.encName ? t("common.on") : t("common.off")}
            </span>
          </div>
        </Field>
      </div>
      <Field label={t("passwd.encPaths")}>
        <textarea
          value={info.encPath.join("\n")}
          onChange={(e) =>
            update(
              "encPath",
              e.target.value
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
          placeholder={t("passwd.encPathsPlaceholder")}
          rows={3}
          className="w-full px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </Field>
    </div>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const { t, lang, setLang } = useI18n();
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [originalPort, setOriginalPort] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/@console/api/settings", { headers: authHeaders() })
      .then((r) => {
        if (r.status === 401) {
          navigate("/login");
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data?.success) {
          setConfig(data.config);
          setOriginalPort(data.config.port);
        }
      })
      .catch(() => setError(t("common.failedToLoad")))
      .finally(() => setLoading(false));
  }, [navigate, t]);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const resp = await fetch("/@console/api/settings", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ config }),
      });
      const data = await resp.json();
      if (data.success) {
        if (config.port !== originalPort) {
          setMessage(t("settings.savedRestarting"));
          await handleRestart();
          return;
        }
        setMessage(t("settings.saved"));
      } else {
        setError(data.message || t("settings.saveFailed"));
      }
    } catch {
      setError(t("common.networkError"));
    } finally {
      setSaving(false);
    }
  };

  const handleRestart = async () => {
    setRestarting(true);
    setError("");
    try {
      const resp = await fetch("/@console/api/restart", {
        method: "POST",
        headers: authHeaders(),
      });
      const data = await resp.json();
      if (data.success) {
        setMessage(t("settings.serverRestarted", { port: String(data.port) }));
        setTimeout(() => {
          window.location.href = `${window.location.origin}${window.location.pathname}#/settings`;
          window.location.reload();
        }, 2000);
      } else {
        setError(data.message || t("settings.restartFailed"));
        setRestarting(false);
      }
    } catch {
      setMessage(t("settings.restartWait"));
      setTimeout(() => {
        window.location.href = `${window.location.origin}${window.location.pathname}#/settings`;
        window.location.reload();
      }, 3000);
    }
  };

  const handleLangSwitch = (newLang: Lang) => {
    setLang(newLang);
    if (config) {
      setConfig({ ...config, web: { ...config.web, lang: newLang } });
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <p className="text-gray-500">{t("common.loading")}</p>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="p-8">
        <p className="text-red-500">{t("common.failedToLoad")}</p>
      </div>
    );
  }

  const updateAlist = (field: keyof AlistServer, value: unknown) => {
    setConfig({
      ...config,
      alistServer: { ...config.alistServer, [field]: value },
    });
  };

  const updatePasswdInfo = (i: number, v: PasswdInfo) => {
    const list = [...config.alistServer.passwdList];
    list[i] = v;
    updateAlist("passwdList", list);
  };

  const removePasswdInfo = (i: number) => {
    const list = config.alistServer.passwdList.filter((_, idx) => idx !== i);
    updateAlist("passwdList", list);
  };

  const addPasswdInfo = () => {
    updateAlist("passwdList", [
      ...config.alistServer.passwdList,
      newPasswdInfo(),
    ]);
  };

  const updateWebdav = (
    i: number,
    field: keyof WebdavServer,
    value: unknown,
  ) => {
    const list = [...config.webdavServer];
    list[i] = { ...list[i], [field]: value };
    setConfig({ ...config, webdavServer: list });
  };

  const updateWebdavPasswd = (wi: number, pi: number, v: PasswdInfo) => {
    const list = [...config.webdavServer];
    const passwdList = [...list[wi].passwdList];
    passwdList[pi] = v;
    list[wi] = { ...list[wi], passwdList };
    setConfig({ ...config, webdavServer: list });
  };

  const removeWebdavPasswd = (wi: number, pi: number) => {
    const list = [...config.webdavServer];
    const passwdList = list[wi].passwdList.filter((_, idx) => idx !== pi);
    list[wi] = { ...list[wi], passwdList };
    setConfig({ ...config, webdavServer: list });
  };

  const addWebdavPasswd = (wi: number) => {
    const list = [...config.webdavServer];
    list[wi] = {
      ...list[wi],
      passwdList: [...list[wi].passwdList, newPasswdInfo()],
    };
    setConfig({ ...config, webdavServer: list });
  };

  return (
    <div className="p-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-800 mb-6">
          {t("settings.title")}
        </h1>

        {/* Basic */}
        <Section title={t("settings.basic")}>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t("settings.listenPort")}>
              <Input
                value={config.port}
                onChange={(v) => setConfig({ ...config, port: Number(v) || 0 })}
                type="number"
              />
            </Field>
            <Field label={t("settings.loginPassword")}>
              <Input
                value={config.password ?? ""}
                onChange={(v) => setConfig({ ...config, password: v })}
                placeholder="123456"
              />
            </Field>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <Toggle
              checked={config.logFile === true}
              onChange={(v) => setConfig({ ...config, logFile: v })}
            />
            <span className="text-sm text-gray-700">
              {t("settings.enableFileLogging")}
            </span>
          </div>
          <div className="mt-4">
            <Field label={t("settings.language")}>
              <select
                value={lang}
                onChange={(e) => handleLangSwitch(e.target.value as Lang)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="en">English</option>
                <option value="zh">中文</option>
              </select>
            </Field>
          </div>
        </Section>

        {/* JWT */}
        <Section title={t("settings.jwtAuth")}>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t("settings.jwtSecret")}>
              <Input
                value={config.jwtSecret ?? ""}
                onChange={(v) => setConfig({ ...config, jwtSecret: v })}
                placeholder="alist-encrypt-secret"
              />
            </Field>
            <Field label={t("settings.jwtExpiry")}>
              <Input
                value={config.jwtExpiresIn ?? ""}
                onChange={(v) => setConfig({ ...config, jwtExpiresIn: v })}
                placeholder="7d"
              />
            </Field>
          </div>
        </Section>

        {/* Alist Server */}
        <Section title={t("settings.alistServer")}>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t("settings.host")}>
              <Input
                value={config.alistServer.serverHost}
                onChange={(v) => updateAlist("serverHost", v)}
                placeholder="192.168.1.100"
              />
            </Field>
            <Field label={t("settings.port")}>
              <Input
                value={config.alistServer.serverPort}
                onChange={(v) => updateAlist("serverPort", Number(v) || 0)}
                type="number"
              />
            </Field>
            <Field label={t("settings.routeMatch")}>
              <Input
                value={config.alistServer.path}
                onChange={(v) => updateAlist("path", v)}
                placeholder="/*"
              />
            </Field>
            <div className="flex items-end gap-2 pb-4">
              <Toggle
                checked={config.alistServer.https}
                onChange={(v) => updateAlist("https", v)}
              />
              <span className="text-sm text-gray-700">
                {t("settings.https")}
              </span>
            </div>
          </div>
        </Section>

        {/* Encryption Rules */}
        <Section title={t("settings.encRules")}>
          {config.alistServer.passwdList.map((info, i) => (
            <PasswdInfoForm
              // biome-ignore lint/suspicious/noArrayIndexKey: controlled form list
              key={`alist-${i}`}
              info={info}
              index={i}
              onChange={updatePasswdInfo}
              onRemove={removePasswdInfo}
            />
          ))}
          <button
            type="button"
            onClick={addPasswdInfo}
            className="w-full py-2 border-2 border-dashed rounded-lg text-sm text-gray-500 hover:text-blue-500 hover:border-blue-400"
          >
            {t("settings.addRule")}
          </button>
        </Section>

        {/* WebDAV Servers */}
        <Section title={t("settings.webdavServers")}>
          {config.webdavServer.length === 0 && (
            <p className="text-sm text-gray-400 mb-4">
              {t("settings.noWebdav")}
            </p>
          )}
          {config.webdavServer.map((srv, wi) => (
            <div key={srv.id} className="border rounded-lg p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium text-gray-700">
                  {srv.name || `WebDAV ${wi + 1}`}
                </span>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">
                      {t("passwd.enabled")}
                    </span>
                    <Toggle
                      checked={srv.enable}
                      onChange={(v) => updateWebdav(wi, "enable", v)}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const list = config.webdavServer.filter(
                        (_, idx) => idx !== wi,
                      );
                      setConfig({ ...config, webdavServer: list });
                    }}
                    className="text-red-500 hover:text-red-700 text-sm"
                  >
                    {t("settings.removeServer")}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <Field label={t("settings.name")}>
                  <Input
                    value={srv.name}
                    onChange={(v) => updateWebdav(wi, "name", v)}
                    placeholder="My WebDAV"
                  />
                </Field>
                <Field label={t("settings.host")}>
                  <Input
                    value={srv.serverHost}
                    onChange={(v) => updateWebdav(wi, "serverHost", v)}
                  />
                </Field>
                <Field label={t("settings.port")}>
                  <Input
                    value={srv.serverPort}
                    onChange={(v) =>
                      updateWebdav(wi, "serverPort", Number(v) || 0)
                    }
                    type="number"
                  />
                </Field>
                <div className="flex items-end gap-2 pb-4">
                  <Toggle
                    checked={srv.https}
                    onChange={(v) => updateWebdav(wi, "https", v)}
                  />
                  <span className="text-sm text-gray-700">
                    {t("settings.https")}
                  </span>
                </div>
              </div>
              <p className="text-sm font-medium text-gray-600 mb-2">
                {t("settings.encRules")}
              </p>
              {srv.passwdList.map((info, pi) => (
                <PasswdInfoForm
                  // biome-ignore lint/suspicious/noArrayIndexKey: controlled form list
                  key={`wda-${wi}-${pi}`}
                  info={info}
                  index={pi}
                  onChange={(i, v) => updateWebdavPasswd(wi, i, v)}
                  onRemove={(i) => removeWebdavPasswd(wi, i)}
                />
              ))}
              <button
                type="button"
                onClick={() => addWebdavPasswd(wi)}
                className="w-full py-2 border-2 border-dashed rounded-lg text-sm text-gray-500 hover:text-blue-500 hover:border-blue-400"
              >
                {t("settings.addRule")}
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setConfig({
                ...config,
                webdavServer: [...config.webdavServer, newWebdavServer()],
              })
            }
            className="w-full py-2 border-2 border-dashed rounded-lg text-sm text-gray-500 hover:text-blue-500 hover:border-blue-400"
          >
            {t("settings.addWebdav")}
          </button>
        </Section>

        {/* Save Button */}
        <div className="sticky bottom-0 bg-gray-100 py-4">
          {message && <p className="text-green-600 text-sm mb-2">{message}</p>}
          {error && <p className="text-red-500 text-sm mb-2">{error}</p>}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || restarting}
            className="w-full bg-blue-500 text-white py-3 rounded-lg hover:bg-blue-600 disabled:opacity-50 font-medium"
          >
            {restarting
              ? t("settings.restarting")
              : saving
                ? t("settings.saving")
                : t("settings.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
