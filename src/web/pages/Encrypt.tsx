import { useState } from "react";
import { Link } from "react-router-dom";

interface ProgressEvent {
  type: "start" | "progress" | "done" | "error";
  total?: number;
  current?: number;
  file?: string;
  status?: string;
  error?: string;
  success?: number;
  failed?: number;
  files?: string[];
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

export default function Encrypt() {
  const [inputDir, setInputDir] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [password, setPassword] = useState("");
  const [encType, setEncType] = useState("aesctr");
  const [encName, setEncName] = useState(false);
  const [running, setRunning] = useState(false);

  // Progress state
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [total, setTotal] = useState(0);
  const [current, setCurrent] = useState(0);
  const [currentFile, setCurrentFile] = useState("");
  const [fileStatus, setFileStatus] = useState("");
  const [fileList, setFileList] = useState<
    { file: string; status: string; error?: string }[]
  >([]);
  const [summary, setSummary] = useState<{
    success: number;
    failed: number;
  } | null>(null);
  const [error, setError] = useState("");

  const handleStart = () => {
    if (!inputDir || !outputDir || !password) {
      setError("Please fill in all fields");
      return;
    }
    setError("");
    setRunning(true);
    setPhase("running");
    setCurrent(0);
    setTotal(0);
    setCurrentFile("");
    setFileStatus("");
    setFileList([]);
    setSummary(null);

    const token = localStorage.getItem("console_token");
    fetch("/@console/api/encrypt", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: token ? `Bearer ${token}` : "",
      },
      body: JSON.stringify({ inputDir, outputDir, password, encType, encName }),
    })
      .then((resp) => {
        if (resp.status === 401) {
          setError("Unauthorized — please login again");
          setRunning(false);
          setPhase("idle");
          return null;
        }
        if (!resp.ok || !resp.body) {
          setError("Server error");
          setRunning(false);
          setPhase("idle");
          return null;
        }
        return resp.body;
      })
      .then((body) => {
        if (!body) return;
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const processStream = (): void => {
          reader.read().then(({ done, value }) => {
            if (done) {
              setRunning(false);
              return;
            }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                try {
                  const event = JSON.parse(line.slice(6)) as ProgressEvent;
                  handleSSEEvent(event);
                } catch {
                  // ignore parse errors
                }
              }
            }
            processStream();
          });
        };
        processStream();
      })
      .catch(() => {
        setError("Network error");
        setRunning(false);
        setPhase("idle");
      });
  };

  const handleSSEEvent = (event: ProgressEvent) => {
    switch (event.type) {
      case "start":
        setTotal(event.total ?? 0);
        setFileList(
          (event.files ?? []).map((f) => ({ file: f, status: "pending" })),
        );
        break;
      case "progress":
        setCurrent(event.current ?? 0);
        setCurrentFile(event.file ?? "");
        setFileStatus(event.status ?? "");
        if (event.file) {
          setFileList((prev) =>
            prev.map((item) =>
              item.file === event.file
                ? { ...item, status: event.status ?? "", error: event.error }
                : item,
            ),
          );
        }
        break;
      case "done":
        setPhase("done");
        setRunning(false);
        setSummary({
          success: event.success ?? 0,
          failed: event.failed ?? 0,
        });
        break;
      case "error":
        setError(event.error ?? "Unknown error");
        setRunning(false);
        setPhase("idle");
        break;
    }
  };

  const progress = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <div className="max-w-3xl mx-auto px-4">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Local Encryption</h1>
          <Link to="/home" className="text-blue-500 hover:underline text-sm">
            Back to Home
          </Link>
        </div>

        {/* Config Form */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4 border-b pb-2">
            Encryption Settings
          </h2>
          <Field label="Input Folder">
            <input
              type="text"
              value={inputDir}
              onChange={(e) => setInputDir(e.target.value)}
              placeholder="C:\Users\...\videos"
              disabled={running}
              className="w-full px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100"
            />
          </Field>
          <Field label="Output Folder">
            <input
              type="text"
              value={outputDir}
              onChange={(e) => setOutputDir(e.target.value)}
              placeholder="C:\Users\...\encrypted"
              disabled={running}
              className="w-full px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Password">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Encryption password"
                disabled={running}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100"
              />
            </Field>
            <Field label="Algorithm">
              <select
                value={encType}
                onChange={(e) => setEncType(e.target.value)}
                disabled={running}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100"
              >
                <option value="aesctr">AES-128-CTR</option>
                <option value="rc4">RC4-MD5</option>
                <option value="mix">MixEnc</option>
              </select>
            </Field>
          </div>
          <div className="flex items-center gap-3 mb-4">
            <button
              type="button"
              onClick={() => !running && setEncName(!encName)}
              disabled={running}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                encName ? "bg-blue-500" : "bg-gray-300"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  encName ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
            <span className="text-sm text-gray-700">Encrypt Filename</span>
          </div>
          {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
          <button
            type="button"
            onClick={handleStart}
            disabled={running}
            className="w-full bg-blue-500 text-white py-3 rounded-lg hover:bg-blue-600 disabled:opacity-50 font-medium"
          >
            {running ? "Encrypting..." : "Start Encryption"}
          </button>
        </div>

        {/* Progress */}
        {(phase === "running" || phase === "done") && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4 border-b pb-2">
              Progress
            </h2>

            {/* Progress bar */}
            <div className="mb-4">
              <div className="flex justify-between text-sm text-gray-600 mb-1">
                <span>
                  {current} / {total} files
                </span>
                <span>{progress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className={`h-3 rounded-full transition-all duration-300 ${
                    phase === "done" && summary?.failed === 0
                      ? "bg-green-500"
                      : "bg-blue-500"
                  }`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {/* Current file */}
            {phase === "running" && currentFile && (
              <p className="text-sm text-gray-600 mb-4">
                <span className="font-medium">Current:</span> {currentFile}
                <span
                  className={`ml-2 text-xs ${
                    fileStatus === "done"
                      ? "text-green-600"
                      : fileStatus === "error"
                        ? "text-red-600"
                        : "text-blue-600"
                  }`}
                >
                  ({fileStatus})
                </span>
              </p>
            )}

            {/* Summary */}
            {phase === "done" && summary && (
              <div
                className={`p-4 rounded-lg mb-4 ${
                  summary.failed === 0
                    ? "bg-green-50 text-green-800"
                    : "bg-yellow-50 text-yellow-800"
                }`}
              >
                <p className="font-medium">
                  {summary.failed === 0
                    ? "All files encrypted successfully!"
                    : `Completed with ${summary.failed} error(s)`}
                </p>
                <p className="text-sm">
                  Success: {summary.success} / Failed: {summary.failed} / Total:{" "}
                  {summary.success + summary.failed}
                </p>
              </div>
            )}

            {/* File list */}
            {fileList.length > 0 && (
              <div className="max-h-64 overflow-y-auto border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">
                        #
                      </th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">
                        File
                      </th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {fileList.map((item, i) => (
                      <tr key={item.file} className="border-t">
                        <td className="px-3 py-2 text-gray-500">{i + 1}</td>
                        <td className="px-3 py-2 font-mono text-gray-800 truncate max-w-xs">
                          {item.file}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`text-xs ${
                              item.status === "done"
                                ? "text-green-600"
                                : item.status === "error"
                                  ? "text-red-600"
                                  : item.status === "encrypting"
                                    ? "text-blue-600"
                                    : "text-gray-400"
                            }`}
                          >
                            {item.status === "error"
                              ? (item.error ?? "error")
                              : item.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
