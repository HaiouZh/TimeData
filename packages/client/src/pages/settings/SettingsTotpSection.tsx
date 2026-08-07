import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { StatusBanner } from "../../components/ui/StatusBanner.js";
import { confirmTotp, disableTotp, fetchTotpStatus, setupTotp, type TotpSetupResponse } from "../../lib/adminApi.ts";
import { messages } from "../../lib/messages.ts";

const primaryButtonClassName =
  "rounded-ctl bg-accent px-4 py-2 td-text-label text-page hover:bg-accent-strong disabled:opacity-40";
const secondaryButtonClassName =
  "rounded-ctl border border-border bg-surface-elevated px-3 py-2 td-text-label text-ink hover:bg-surface-hover disabled:opacity-40";
const dangerButtonClassName =
  "rounded-ctl bg-danger px-3 py-2 td-text-label text-page hover:bg-danger/80 disabled:opacity-40";
const inputClassName = "w-full rounded-ctl border border-border bg-surface-elevated px-3 py-2 td-text-body text-ink";

const totpMessages = messages.totp;

/**
 * TOTP 两步锁设置区块：查询绑定状态 → 启用（二维码 + secret + 恢复码 + 确认码）→
 * 已启用后提供需输码的停用入口。挂在服务端管理设置页内。
 */
export default function SettingsTotpSection() {
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [statusError, setStatusError] = useState("");
  const [pending, setPending] = useState<TotpSetupResponse | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [confirmCode, setConfirmCode] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [disabling, setDisabling] = useState(false);
  const [disableCode, setDisableCode] = useState("");
  const [disableError, setDisableError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchTotpStatus()
      .then((status) => {
        if (!cancelled) setEnrolled(status.enrolled);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setStatusError(`${totpMessages.statusLoadFailed}：${err instanceof Error ? err.message : String(err)}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSetup() {
    setBusy(true);
    setStatusError("");
    try {
      const response = await setupTotp();
      const dataUrl = await QRCode.toDataURL(response.otpauthUri);
      setPending(response);
      setQrDataUrl(dataUrl);
      setConfirmCode("");
      setConfirmError("");
    } catch (err) {
      setStatusError(`${totpMessages.setupFailed}：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    if (!confirmCode) return;
    setBusy(true);
    setConfirmError("");
    try {
      await confirmTotp(confirmCode);
      setEnrolled(true);
      setPending(null);
      setQrDataUrl("");
      setConfirmCode("");
    } catch {
      setConfirmError(totpMessages.confirmFailed);
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    if (!disableCode) return;
    setBusy(true);
    setDisableError("");
    try {
      await disableTotp(disableCode);
      setEnrolled(false);
      setDisabling(false);
      setDisableCode("");
    } catch {
      setDisableError(totpMessages.disableFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-card border border-border bg-surface p-4">
      <h3 className="td-text-body font-medium text-ink-2">{totpMessages.sectionTitle}</h3>
      <p className="td-text-caption text-ink-3">{totpMessages.sectionIntro}</p>

      {statusError && <StatusBanner tone="danger">{statusError}</StatusBanner>}

      {enrolled === false && !pending && (
        <div className="space-y-2">
          <div className="td-text-body text-ink-2">{totpMessages.statusDisabled}</div>
          <button type="button" disabled={busy} onClick={() => void handleSetup()} className={primaryButtonClassName}>
            {totpMessages.enableButton}
          </button>
        </div>
      )}

      {pending && (
        <div className="space-y-3">
          <p className="td-text-body text-warn">{totpMessages.scanHint}</p>
          {qrDataUrl && (
            <img src={qrDataUrl} alt="TOTP 绑定二维码" className="h-44 w-44 rounded-ctl border border-border bg-page p-2" />
          )}
          <div className="space-y-1">
            <div className="td-text-caption text-ink-3">{totpMessages.secretLabel}</div>
            <code className="block break-all rounded-ctl bg-surface-elevated px-3 py-2 td-text-caption text-ink">
              {pending.secret}
            </code>
          </div>
          <div className="space-y-1">
            <div className="td-text-caption text-ink-3">{totpMessages.recoveryCodesLabel}</div>
            <div className="grid grid-cols-2 gap-1 rounded-ctl bg-surface-elevated p-3">
              {pending.recoveryCodes.map((code) => (
                <code key={code} className="td-text-caption text-ink">
                  {code}
                </code>
              ))}
            </div>
            <p className="td-text-caption text-warn">{totpMessages.recoveryCodesOnce}</p>
            <p className="td-text-caption text-ink-3">{totpMessages.recoveryCodesLost}</p>
          </div>
          <label className="block space-y-1 td-text-caption text-ink-3">
            {totpMessages.confirmInputLabel}
            <input
              aria-label="确认绑定动态码"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={confirmCode}
              disabled={busy}
              onChange={(event) => setConfirmCode(event.target.value)}
              className={inputClassName}
            />
          </label>
          {confirmError && <div className="td-text-body text-danger">{confirmError}</div>}
          <button
            type="button"
            disabled={busy || !confirmCode}
            onClick={() => void handleConfirm()}
            className={primaryButtonClassName}
          >
            {totpMessages.confirmButton}
          </button>
        </div>
      )}

      {enrolled === true && (
        <div className="space-y-2">
          <div className="td-text-body text-ink-2">{totpMessages.statusEnabled}</div>
          {!disabling && (
            <button type="button" disabled={busy} onClick={() => setDisabling(true)} className={secondaryButtonClassName}>
              {totpMessages.disableButton}
            </button>
          )}
          {disabling && (
            <div className="space-y-2">
              <label className="block space-y-1 td-text-caption text-ink-3">
                {totpMessages.disableInputLabel}
                <input
                  aria-label="停用动态码"
                  type="text"
                  inputMode="text"
                  autoComplete="one-time-code"
                  value={disableCode}
                  disabled={busy}
                  onChange={(event) => setDisableCode(event.target.value)}
                  className={inputClassName}
                />
              </label>
              {disableError && <div className="td-text-body text-danger">{disableError}</div>}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleDisable()}
                  className={dangerButtonClassName}
                >
                  {totpMessages.disableConfirmButton}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setDisabling(false);
                    setDisableCode("");
                    setDisableError("");
                  }}
                  className={secondaryButtonClassName}
                >
                  {messages.dialog.cancel}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
