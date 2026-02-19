import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CheckCircle,
  Circle,
  ExternalLink,
  Eye,
  EyeOff,
  Info,
  Loader2,
  Lock,
  MessageCircle,
  Settings,
  Shield,
  ShieldAlert,
  Terminal,
  Trash2,
  Wifi,
  XCircle,
  Zap,
} from 'lucide-react';

interface OpenClawOnboardingProps {
  onClose: () => void;
}

type StepStatus = 'pending' | 'running' | 'done' | 'error';

const STEPS = [
  'Welcome',
  'Safety & Permissions',
  'Prerequisites',
  'Install OpenClaw',
  'Onboard & Daemon',
  'AI Provider',
  'Your Bot',
  'Channels',
  'Launch Gateway',
  'How It Works',
  'Done',
];

// Run commands through a login shell so nvm/volta/fnm/homebrew are properly loaded
// (-l = login shell sources ~/.zprofile, ~/.profile, etc. which set up version managers)
const HOME = window.electron.homeDir;
const LOGIN_ENV = { HOME };

// Helper: wrap a shell command to run through login shell (picks up nvm, volta, etc.)
function loginShellExec(cmd: string) {
  return window.electron.execCommand('/bin/zsh', ['-l', '-c', cmd], { shell: false, env: LOGIN_ENV });
}

// Helper: invoke openclaw CLI using the system node (v22) to bypass nvm version restrictions.
// Finds the openclaw dist/index.js via glob across all nvm-managed node versions.
function openclawExec(args: string) {
  const script = `_OC=$(ls "${HOME}/.nvm/versions/node/"*/lib/node_modules/openclaw/dist/index.js 2>/dev/null | head -1); /usr/local/bin/node "$_OC" ${args} 2>&1`;
  return window.electron.execCommand('/bin/zsh', ['-c', script], { shell: false, env: { HOME } });
}

// Detect node version error in streamed output
function hasNodeVersionError(text: string): boolean {
  const t = text.toLowerCase();
  return t.includes('requires node') || t.includes('upgrade node') || t.includes('install node: https') || t.includes('re-run openclaw');
}

// OpenClaw brand icon from dashboard-icons CDN
const OPENCLAW_ICON_URL = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/openclaw.png';
// OpenClaw text logo
const OPENCLAW_LOGO_URL = 'https://mintcdn.com/clawdhub/-t5HSeZ3Y_0_wH4i/assets/openclaw-logo-text-dark.png';

// OpenClaw brand colors
// Primary red: #ea4647 (Cinnabar), deeper red: #c83232, bg: #050811
const BRAND = {
  red: '#ea4647',
  redDeep: '#c83232',
  redDim: 'rgba(234,70,71,0.22)',
  redBorder: 'rgba(234,70,71,0.35)',
  redGlow: 'rgba(234,70,71,0.60)',
  bg: '#050811',
};

const CHANNELS = [
  {
    id: 'imessage',
    title: 'iMessage',
    description: 'Native macOS integration. Chat with your AI agent via Messages app.',
    docsUrl: 'https://docs.openclaw.ai/channels/imessage',
    badge: 'macOS only',
    badgeStyle: { borderColor: 'rgba(234,70,71,0.35)', background: 'rgba(234,70,71,0.14)', color: '#fca5a5' },
  },
  {
    id: 'whatsapp',
    title: 'WhatsApp',
    description: 'Connect via WhatsApp Web. Requires WhatsApp on your phone.',
    docsUrl: 'https://docs.openclaw.ai/channels/whatsapp',
    badge: null,
    badgeStyle: {},
  },
  {
    id: 'telegram',
    title: 'Telegram',
    description: 'Create a Telegram bot and connect in minutes.',
    docsUrl: 'https://docs.openclaw.ai/channels/telegram',
    badge: 'Easiest',
    badgeStyle: { borderColor: 'rgba(110,231,183,0.35)', background: 'rgba(16,185,129,0.18)', color: '#6ee7b7' },
  },
  {
    id: 'discord',
    title: 'Discord',
    description: 'Deploy an AI bot to any Discord server you manage.',
    docsUrl: 'https://docs.openclaw.ai/channels/discord',
    badge: null,
    badgeStyle: {},
  },
  {
    id: 'signal',
    title: 'Signal',
    description: 'End-to-end encrypted messaging via Signal.',
    docsUrl: 'https://docs.openclaw.ai/channels/signal',
    badge: null,
    badgeStyle: {},
  },
  {
    id: 'slack',
    title: 'Slack',
    description: 'Add an AI agent to your Slack workspace or DMs.',
    docsUrl: 'https://docs.openclaw.ai/channels/slack',
    badge: null,
    badgeStyle: {},
  },
];

// Available models per provider. First entry = OpenClaw recommended.
const MODELS: Record<'anthropic' | 'openai', Array<{ id: string; label: string; recommended?: boolean }>> = {
  anthropic: [
    { id: 'anthropic/claude-opus-4-6',   label: 'Claude Opus 4.6',    recommended: true },
    { id: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  ],
  openai: [
    { id: 'openai/gpt-5.2',       label: 'GPT-5.2',              recommended: true },
    { id: 'openai/gpt-5-mini',    label: 'GPT-5 Mini (fast)' },
    { id: 'openai/gpt-5.1-codex', label: 'GPT-5.1 Codex (coding)' },
  ],
};

const OpenClawOnboarding: React.FC<OpenClawOnboardingProps> = ({ onClose }) => {
  // mode: 'wizard' = first-time setup, 'settings' = already configured
  const [mode, setMode] = useState<'wizard' | 'settings'>(() =>
    localStorage.getItem('openclaw_setup_done') === 'true' ? 'settings' : 'wizard'
  );
  const [step, setStep] = useState(() => {
    if (localStorage.getItem('openclaw_setup_done') === 'true') return 0;
    const saved = parseInt(localStorage.getItem('openclaw_wizard_step') || '0', 10);
    return isNaN(saved) ? 0 : saved;
  });
  const [logoError, setLogoError] = useState(false);

  // Safety acknowledgment — user must explicitly accept before proceeding
  const [safetyAcknowledged, setSafetyAcknowledged] = useState(false);

  // Prerequisites state
  const [nodeStatus, setNodeStatus] = useState<StepStatus>('pending');
  const [nodeVersion, setNodeVersion] = useState('');
  // null=checking, true=installed+working, false=not found, 'broken'=found but fails to run
  const [openClawInstalled, setOpenClawInstalled] = useState<boolean | 'broken' | null>(null);
  const [prereqChecked, setPrereqChecked] = useState(false);

  // Install state
  const [installStatus, setInstallStatus] = useState<StepStatus>('pending');
  const [installLines, setInstallLines] = useState<string[]>([]);
  const [installNodeError, setInstallNodeError] = useState(false);
  const installSpawnPid = useRef<number | null>(null);

  // Onboard state
  const [onboardStatus, setOnboardStatus] = useState<StepStatus>('pending');
  const [onboardLines, setOnboardLines] = useState<string[]>([]);
  const [onboardNodeError, setOnboardNodeError] = useState(false);
  const [onboardWarningDismissed, setOnboardWarningDismissed] = useState(false);
  const onboardSpawnPid = useRef<number | null>(null);

  // Config / AI provider state
  const [configContent, setConfigContent] = useState<string | null>(null);
  const [configError, setConfigError] = useState('');

  // API key input state
  const [selectedProvider, setSelectedProvider] = useState<'anthropic' | 'openai'>('anthropic');
  const [existingApiProvider, setExistingApiProvider] = useState<null | 'anthropic' | 'openai'>(null);
  const [apiKey, setApiKey] = useState('');
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [apiKeySaveStatus, setApiKeySaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [apiKeyError, setApiKeyError] = useState('');
  // Selected model — defaults to OpenClaw-recommended model per provider
  const [selectedModel, setSelectedModel] = useState('anthropic/claude-opus-4-6');

  // Gateway state
  const [gatewayStatus, setGatewayStatus] = useState<'unknown' | 'running' | 'stopped'>('unknown');
  const [gatewayCheckLoading, setGatewayCheckLoading] = useState(false);
  const [gatewayStartStatus, setGatewayStartStatus] = useState<StepStatus>('pending');
  const [gatewayToken, setGatewayToken] = useState<string | null>(null);
  const [gatewayConfigStatus, setGatewayConfigStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const gatewaySpawnPid = useRef<number | null>(null);
  const gatewayPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Channels state — which channel card is expanded
  const [expandedChannel, setExpandedChannel] = useState<string | null>(null);

  // Telegram setup
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramSaveStatus, setTelegramSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [telegramBotUsername, setTelegramBotUsername] = useState<string | null>(null);
  const [telegramPhone, setTelegramPhone] = useState('');
  const [telegramAllowSaved, setTelegramAllowSaved] = useState(false);

  // WhatsApp setup
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [whatsappAllowSaved, setWhatsappAllowSaved] = useState(false);
  const [whatsappQrLines, setWhatsappQrLines] = useState<string[]>([]);
  const [whatsappSetupStatus, setWhatsappSetupStatus] = useState<StepStatus>('pending');
  const whatsappSpawnPid = useRef<number | null>(null);
  const whatsappOutputRef = useRef<HTMLPreElement | null>(null);

  // Bot identity (Your Bot step)
  const [botName, setBotName] = useState('');
  const [botPersonality, setBotPersonality] = useState('');
  const [botMemory, setBotMemory] = useState('');
  const [identitySavedStatus, setIdentitySavedStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Settings mode — which settings section is active
  const [settingsSection, setSettingsSection] = useState<'overview' | 'api' | 'channels' | 'bot' | 'skills' | 'security'>('overview');
  // Security audit state
  const [doctorStatus, setDoctorStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [doctorOutput, setDoctorOutput] = useState('');
  const [auditStatus, setAuditStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [auditOutput, setAuditOutput] = useState('');
  // Fix config status
  const [fixConfigStatus, setFixConfigStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  // Uninstall state
  const [showUninstallConfirm, setShowUninstallConfirm] = useState(false);
  const [deleteData, setDeleteData] = useState(false);
  const [uninstallStatus, setUninstallStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [uninstallStep, setUninstallStep] = useState('');

  // Test message state (Done step)
  const [testMsgStatus, setTestMsgStatus] = useState<'idle' | 'checking' | 'sending' | 'sent' | 'error'>('idle');
  const [testMsgError, setTestMsgError] = useState('');
  const [manualPairingCode, setManualPairingCode] = useState('');
  const [manualTelegramId, setManualTelegramId] = useState('');
  const [pairingApproveStatus, setPairingApproveStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');

  const installOutputRef = useRef<HTMLPreElement | null>(null);
  const onboardOutputRef = useRef<HTMLPreElement | null>(null);

  // One-time startup fix: remove invalid keys written by older wizard versions
  // (agents.defaults.name/instructions/memoryInstructions, channels.telegram.token/allowList)
  useEffect(() => {
    const fixScript = `node -e "const fs=require('fs');const p=process.env.HOME+'/.openclaw/openclaw.json';try{const c=JSON.parse(fs.readFileSync(p,'utf8'));let dirty=false;if(c.agents&&c.agents.defaults&&('name' in c.agents.defaults||'instructions' in c.agents.defaults||'memoryInstructions' in c.agents.defaults)){delete c.agents.defaults.name;delete c.agents.defaults.instructions;delete c.agents.defaults.memoryInstructions;dirty=true;}if(c.channels&&c.channels.telegram){if('token' in c.channels.telegram){c.channels.telegram.botToken=c.channels.telegram.botToken||c.channels.telegram.token;delete c.channels.telegram.token;dirty=true;}if('allowList' in c.channels.telegram){c.channels.telegram.allowFrom=c.channels.telegram.allowFrom||c.channels.telegram.allowList;delete c.channels.telegram.allowList;dirty=true;}}if(c.channels&&c.channels.whatsapp&&'allowList' in c.channels.whatsapp){c.channels.whatsapp.allowFrom=c.channels.whatsapp.allowFrom||c.channels.whatsapp.allowList;delete c.channels.whatsapp.allowList;dirty=true;}if(dirty)fs.writeFileSync(p,JSON.stringify(c,null,2));}catch(e){}"`;
    window.electron.execCommand('/bin/zsh', ['-l', '-c', fixScript], { shell: false, env: { HOME } }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup spawned processes on unmount
  useEffect(() => {
    return () => {
      if (installSpawnPid.current != null) {
        window.electron.killSpawnProcess(installSpawnPid.current).catch(() => {});
      }
      if (onboardSpawnPid.current != null) {
        window.electron.killSpawnProcess(onboardSpawnPid.current).catch(() => {});
      }
      if (gatewaySpawnPid.current != null) {
        window.electron.killSpawnProcess(gatewaySpawnPid.current).catch(() => {});
      }
      if (whatsappSpawnPid.current != null) {
        window.electron.killSpawnProcess(whatsappSpawnPid.current).catch(() => {});
      }
      if (gatewayPollRef.current != null) {
        clearInterval(gatewayPollRef.current);
      }
    };
  }, []);

  // Persist wizard step to localStorage so user can resume where they left off
  useEffect(() => {
    if (mode === 'wizard') {
      localStorage.setItem('openclaw_wizard_step', String(step));
    }
  }, [step, mode]);

  // Auto-scroll WhatsApp QR output
  useEffect(() => {
    if (whatsappOutputRef.current) {
      whatsappOutputRef.current.scrollTop = whatsappOutputRef.current.scrollHeight;
    }
  }, [whatsappQrLines]);

  // Auto-scroll terminal panels
  useEffect(() => {
    if (installOutputRef.current) {
      installOutputRef.current.scrollTop = installOutputRef.current.scrollHeight;
    }
  }, [installLines]);

  useEffect(() => {
    if (onboardOutputRef.current) {
      onboardOutputRef.current.scrollTop = onboardOutputRef.current.scrollHeight;
    }
  }, [onboardLines]);

  // ─── Check prerequisites ──────────────────────────────────────────
  const checkPrerequisites = useCallback(async () => {
    setPrereqChecked(false);
    setNodeStatus('running');
    setOpenClawInstalled(null);
    try {
      // Use login shell so nvm/volta/fnm are properly loaded
      const nodeResult = await loginShellExec('node --version 2>&1');
      if (nodeResult.exitCode === 0) {
        const ver = nodeResult.stdout.trim();
        setNodeVersion(ver);
        const major = parseInt(ver.replace(/^v/, '').split('.')[0], 10);
        setNodeStatus(major >= 22 ? 'done' : 'error');
      } else {
        setNodeVersion('not found');
        setNodeStatus('error');
      }
    } catch {
      setNodeVersion('not found');
      setNodeStatus('error');
    }

    try {
      // First check if the binary exists
      const whichResult = await loginShellExec('which openclaw 2>&1');
      if (whichResult.exitCode !== 0) {
        setOpenClawInstalled(false);
      } else {
        // Binary found — verify it actually runs (a broken/partial install shows as found but crashes)
        const versionResult = await loginShellExec('openclaw --version 2>&1');
        if (versionResult.exitCode === 0) {
          setOpenClawInstalled(true);
        } else {
          // Found in PATH but won't run — likely wrong Node version or corrupt install
          setOpenClawInstalled('broken');
        }
      }
    } catch {
      setOpenClawInstalled(false);
    }
    setPrereqChecked(true);
  }, []);

  // Run prereq check on step 2 (was 1, shifted +1 by Safety step)
  useEffect(() => {
    if (step === 2 && !prereqChecked) {
      void checkPrerequisites();
    }
  }, [step, prereqChecked, checkPrerequisites]);

  // Load config on step 5 (AI Provider) — also auto-detect which provider is already configured
  useEffect(() => {
    if (step !== 5) return;
    const configPath = `${window.electron.homeDir}/.openclaw/openclaw.json`;
    window.electron.readFile(configPath)
      .then((content) => {
        setConfigContent(content);
        setConfigError('');
        try {
          const cfg = JSON.parse(content);
          const env = cfg.env || {};
          if (env.ANTHROPIC_API_KEY) {
            setExistingApiProvider('anthropic');
            setSelectedProvider('anthropic');
          } else if (env.OPENAI_API_KEY) {
            setExistingApiProvider('openai');
            setSelectedProvider('openai');
          } else {
            setExistingApiProvider(null);
          }
        } catch { /* ignore parse errors */ }
      })
      .catch(() => { setConfigContent(null); setConfigError('Config not found — run the onboarding step first.'); });
  }, [step]);

  // Load existing bot identity on step 6 (Your Bot)
  useEffect(() => {
    if (step !== 6) return;
    const configPath = `${HOME}/.openclaw/openclaw.json`;
    window.electron.readFile(configPath).then((content) => {
      try {
        const cfg = JSON.parse(content);
        // Read from agents.defaults (current schema) with fallback to legacy agent.*
        const identity = cfg.agents?.defaults || cfg.agent || {};
        if (identity.name) setBotName(identity.name);
        if (identity.instructions) setBotPersonality(identity.instructions);
        if (identity.memoryInstructions) setBotMemory(identity.memoryInstructions);
      } catch { /* ignore parse errors */ }
    }).catch(() => {});
  }, [step]);

  // Check gateway status on step 8 (Launch Gateway) — also ensure token is configured
  useEffect(() => {
    if (step !== 8) return;
    void ensureGatewayConfig();
    void checkGatewayStatus();
  }, [step]);

  // When in settings mode, load token + gateway status + bot identity immediately
  useEffect(() => {
    if (mode !== 'settings') return;
    void ensureGatewayConfig();
    void checkGatewayStatus();
    // Load existing bot identity — read from agents.defaults (current schema) with legacy fallback
    window.electron.readFile(`${HOME}/.openclaw/openclaw.json`).then((content) => {
      try {
        const cfg = JSON.parse(content);
        const identity = cfg.agents?.defaults || cfg.agent || {};
        if (identity.name) setBotName(identity.name);
        if (identity.instructions) setBotPersonality(identity.instructions);
        if (identity.memoryInstructions) setBotMemory(identity.memoryInstructions);
      } catch { /* ignore */ }
    }).catch(() => {});
  }, [mode]);

  // ─── Install OpenClaw ─────────────────────────────────────────────
  const runInstall = useCallback(async () => {
    setInstallStatus('running');
    setInstallNodeError(false);
    setOpenClawInstalled(null);   // reset so broken state doesn't linger during reinstall
    setInstallLines(['Starting installation...\n']);
    // Use login shell so nvm/volta/fnm are active and npm installs to the right Node version
    const installCmd = 'curl -fsSL https://openclaw.ai/install.sh | bash';
    try {
      const { pid } = await window.electron.spawnProcess('/bin/zsh', ['-l', '-c', installCmd], {
        shell: false,
        env: LOGIN_ENV,
      });
      installSpawnPid.current = pid;
      const decoder = new TextDecoder();
      let alreadyDone = false;

      // Helper: mark install done and kill the process (needed because the install script
      // may run `openclaw doctor` at the end — an interactive TUI that hangs forever
      // waiting for terminal input since there's no TTY in our spawned process).
      const markDone = () => {
        if (alreadyDone) return;
        alreadyDone = true;
        setInstallStatus('done');
        setInstallLines((prev) => [...prev, '\n✓ OpenClaw installed successfully!']);
        setOpenClawInstalled(true);
        setTimeout(() => {
          if (installSpawnPid.current != null) {
            window.electron.killSpawnProcess(installSpawnPid.current).catch(() => {});
            installSpawnPid.current = null;
          }
        }, 500);
      };

      const unsubscribe = window.electron.onSpawnEvent((event) => {
        if (event.pid !== pid) return;
        if (event.type === 'stdout' || event.type === 'stderr') {
          const text = decoder.decode(event.data);
          setInstallLines((prev) => [...prev, text]);
          if (hasNodeVersionError(text)) setInstallNodeError(true);
          // Detect success message and auto-complete — don't wait for the script to fully
          // exit since it may spin into an interactive doctor prompt that hangs without a TTY.
          if (
            text.includes('OpenClaw installed successfully') ||
            text.includes('Upgrade complete') ||
            text.includes('✓ OpenClaw installed')
          ) {
            unsubscribe();
            markDone();
          }
        }
        if (event.type === 'exit') {
          installSpawnPid.current = null;
          unsubscribe();
          if (!alreadyDone) {
            if (event.code === 0) {
              markDone();
            } else {
              setInstallStatus('error');
              setInstallLines((prev) => [...prev, `\n✗ Installation failed (exit ${event.code}).`]);
            }
          }
        }
        if (event.type === 'error') {
          installSpawnPid.current = null;
          unsubscribe();
          if (!alreadyDone) {
            setInstallStatus('error');
            setInstallLines((prev) => [...prev, `\n✗ ${event.message}`]);
          }
        }
      });
    } catch (err: any) {
      setInstallStatus('error');
      setInstallLines((prev) => [...prev, `\n✗ Failed to start: ${err?.message || err}`]);
    }
  }, []);

  // ─── Run openclaw onboard ─────────────────────────────────────────
  const runOnboard = useCallback(async () => {
    setOnboardStatus('running');
    setOnboardNodeError(false);
    setOnboardLines(['Starting openclaw onboard...\n']);
    try {
      // Clean up any unrecognized config keys before onboarding (e.g. "model" from a previous failed attempt)
      await loginShellExec('openclaw doctor --fix 2>/dev/null || true');
      const { pid } = await window.electron.spawnProcess(
        '/bin/zsh',
        ['-l', '-c', 'openclaw onboard --non-interactive --accept-risk --install-daemon'],
        { shell: false, env: LOGIN_ENV },
      );
      onboardSpawnPid.current = pid;
      const decoder = new TextDecoder();
      let onboardDone = false;

      const markOnboardDone = () => {
        if (onboardDone) return;
        onboardDone = true;
        setOnboardStatus('done');
        setOnboardLines((prev) => [...prev, '\n✓ All done! Your assistant is ready.']);
        setTimeout(() => {
          if (onboardSpawnPid.current != null) {
            window.electron.killSpawnProcess(onboardSpawnPid.current).catch(() => {});
            onboardSpawnPid.current = null;
          }
        }, 500);
      };

      const unsubscribe = window.electron.onSpawnEvent((event) => {
        if (event.pid !== pid) return;
        if (event.type === 'stdout' || event.type === 'stderr') {
          const text = decoder.decode(event.data);
          setOnboardLines((prev) => [...prev, text]);
          if (hasNodeVersionError(text)) setOnboardNodeError(true);
          // Detect completion and auto-close to avoid hanging on any subsequent interactive prompts
          if (
            text.toLowerCase().includes('onboarding complete') ||
            text.toLowerCase().includes('daemon installed') ||
            text.toLowerCase().includes('launchagent') ||
            text.toLowerCase().includes('setup complete') ||
            text.toLowerCase().includes('onboard complete')
          ) {
            unsubscribe();
            markOnboardDone();
          }
        }
        if (event.type === 'exit') {
          onboardSpawnPid.current = null;
          unsubscribe();
          if (!onboardDone) {
            if (event.code === 0) {
              markOnboardDone();
            } else {
              setOnboardStatus('error');
              setOnboardLines((prev) => [...prev, `\n✗ Onboard failed (exit ${event.code}).`]);
            }
          }
        }
        if (event.type === 'error') {
          onboardSpawnPid.current = null;
          unsubscribe();
          if (!onboardDone) {
            setOnboardStatus('error');
            setOnboardLines((prev) => [...prev, `\n✗ ${event.message}`]);
          }
        }
      });
    } catch (err: any) {
      setOnboardStatus('error');
      setOnboardLines((prev) => [...prev, `\n✗ Failed to start: ${err?.message || err}`]);
    }
  }, []);

  // ─── Save API key directly into openclaw.json ─────────────────────
  const saveApiKey = useCallback(async () => {
    if (!apiKey.trim()) return;
    setApiKeySaveStatus('saving');
    setApiKeyError('');
    const envVar = selectedProvider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
    const modelId = selectedModel || (selectedProvider === 'anthropic' ? 'anthropic/claude-opus-4-6' : 'openai/gpt-5.2');
    // openclaw uses root-level "env" for API keys — NOT "model.env" (which is unrecognized)
    // Pass key via env var so no shell-injection risk even if key contains special chars
    const script = `node -e "const fs=require('fs');const p=process.env.HOME+'/.openclaw/openclaw.json';const c=JSON.parse(fs.readFileSync(p,'utf8'));c.env=c.env||{};c.env[process.env.ENV_VAR]=process.env.API_KEY;fs.writeFileSync(p,JSON.stringify(c,null,2));"`;
    // Also write auth-profiles.json for the embedded agent (reads this file, not openclaw.json env)
    const authProfilesScript = `node -e "const fs=require('fs');const dir=process.env.HOME+'/.openclaw/agents/main/agent';fs.mkdirSync(dir,{recursive:true});const p=dir+'/auth-profiles.json';let c={version:1,profiles:{}};try{c=JSON.parse(fs.readFileSync(p,'utf8'));}catch(e){}c.version=1;c.profiles=c.profiles||{};c.profiles[process.env.PROFILE_ID]={type:'api_key',provider:process.env.PROVIDER,key:process.env.API_KEY};fs.writeFileSync(p,JSON.stringify(c,null,2));"`;
    try {
      const result = await window.electron.execCommand('/bin/zsh', ['-l', '-c', script], {
        shell: false,
        env: { HOME, API_KEY: apiKey.trim(), ENV_VAR: envVar },
      });
      if (result.exitCode !== 0) {
        setApiKeySaveStatus('error');
        setApiKeyError('Could not save — make sure the Onboard step completed successfully.');
        return;
      }
      // Write auth-profiles.json so the embedded agent can find the key
      await window.electron.execCommand('/bin/zsh', ['-l', '-c', authProfilesScript], {
        shell: false,
        env: { HOME, API_KEY: apiKey.trim(), PROVIDER: selectedProvider, PROFILE_ID: `${selectedProvider}:default` },
      });
      // Set the default model to match the chosen provider
      await loginShellExec(`openclaw models set ${modelId} 2>/dev/null || true`);
      setApiKeySaveStatus('saved');
      // Refresh config preview
      window.electron.readFile(`${HOME}/.openclaw/openclaw.json`)
        .then((c) => setConfigContent(c))
        .catch(() => {});
    } catch {
      setApiKeySaveStatus('error');
      setApiKeyError('Something went wrong. You can also paste the key directly in the config file.');
    }
  }, [selectedProvider, selectedModel, apiKey]);

  // ─── Gateway token config ─────────────────────────────────────────
  // Sets gateway.mode=local and generates/reads a gateway auth token.
  // Without this the dashboard shows "token missing" and nothing works.
  const ensureGatewayConfig = useCallback(async () => {
    if (gatewayConfigStatus === 'done' || gatewayConfigStatus === 'running') return;
    setGatewayConfigStatus('running');
    try {
      // Check if token already set
      const readResult = await loginShellExec(
        `node -e "const fs=require('fs');const p=process.env.HOME+'/.openclaw/openclaw.json';try{const c=JSON.parse(fs.readFileSync(p,'utf8'));const t=(c.gateway||{}).auth?.token||'';console.log(t);}catch{console.log('');}"`
      );
      const existingToken = readResult.stdout.trim();
      if (existingToken && existingToken.length > 10) {
        setGatewayToken(existingToken);
        setGatewayConfigStatus('done');
        return;
      }
      // Set gateway.mode=local and generate + save a new token
      const script = `
node -e "
const fs=require('fs');
const crypto=require('crypto');
const p=process.env.HOME+'/.openclaw/openclaw.json';
const c=JSON.parse(fs.readFileSync(p,'utf8'));
c.gateway=c.gateway||{};
c.gateway.mode='local';
c.gateway.auth=c.gateway.auth||{};
const token=crypto.randomBytes(32).toString('hex');
c.gateway.auth.token=token;
fs.writeFileSync(p,JSON.stringify(c,null,2));
console.log(token);
"`.trim();
      const result = await loginShellExec(script);
      if (result.exitCode === 0 && result.stdout.trim().length > 10) {
        setGatewayToken(result.stdout.trim());
        setGatewayConfigStatus('done');
      } else {
        setGatewayConfigStatus('error');
      }
    } catch {
      setGatewayConfigStatus('error');
    }
  }, [gatewayConfigStatus]);

  // ─── Save Telegram bot token ──────────────────────────────────────
  const saveTelegramToken = useCallback(async () => {
    if (!telegramToken.trim()) return;
    setTelegramSaveStatus('saving');
    // Use 'botToken' (not 'token') — the correct field name per OpenClaw schema
    // Also delete the old 'token' key if present from a previous incorrect save
    const script = `node -e "const fs=require('fs');const p=process.env.HOME+'/.openclaw/openclaw.json';const c=JSON.parse(fs.readFileSync(p,'utf8'));c.channels=c.channels||{};c.channels.telegram=c.channels.telegram||{};c.channels.telegram.botToken=process.env.TG_TOKEN;delete c.channels.telegram.token;fs.writeFileSync(p,JSON.stringify(c,null,2));"`;
    try {
      const result = await window.electron.execCommand('/bin/zsh', ['-l', '-c', script], {
        shell: false,
        env: { HOME, TG_TOKEN: telegramToken.trim() },
      });
      if (result.exitCode === 0) {
        setTelegramSaveStatus('saved');
        // Fetch the bot username from Telegram so we can show how to start a conversation
        try {
          const resp = await fetch(`https://api.telegram.org/bot${telegramToken.trim()}/getMe`);
          const data = await resp.json();
          if (data.ok && (data as { ok: boolean; result?: { username?: string } }).result?.username) {
            setTelegramBotUsername((data as { ok: boolean; result?: { username?: string } }).result!.username!);
          }
        } catch { /* non-fatal — username display is just a convenience */ }
      } else {
        setTelegramSaveStatus('error');
      }
    } catch {
      setTelegramSaveStatus('error');
    }
  }, [telegramToken]);

  // ─── Save Telegram allowFrom (your phone number) ──────────────────
  const saveTelegramAllowList = useCallback(async () => {
    const raw = telegramPhone.trim();
    if (!raw) return;
    // Only accept pure numeric Telegram user IDs — reject phone numbers like "+1 608..."
    if (!/^\d+$/.test(raw)) return;
    // Use 'allowFrom' (not 'allowList') — the correct field name per OpenClaw schema
    const script = `node -e "const fs=require('fs');const p=process.env.HOME+'/.openclaw/openclaw.json';const c=JSON.parse(fs.readFileSync(p,'utf8'));c.channels=c.channels||{};c.channels.telegram=c.channels.telegram||{};c.channels.telegram.allowFrom=[Number(process.env.TG_ID)];delete c.channels.telegram.allowList;fs.writeFileSync(p,JSON.stringify(c,null,2));"`;
    try {
      await window.electron.execCommand('/bin/zsh', ['-l', '-c', script], {
        shell: false,
        env: { HOME, TG_ID: raw },
      });
      setTelegramAllowSaved(true);
    } catch { /* non-fatal */ }
  }, [telegramPhone]);

  // ─── Save WhatsApp allowList (your phone number) ──────────────────
  const saveWhatsappAllowList = useCallback(async () => {
    if (!whatsappPhone.trim()) return;
    // Use 'allowFrom' (not 'allowList') — the correct field name per OpenClaw schema
    // WhatsApp allowFrom accepts phone number strings (unlike Telegram which needs numeric IDs)
    const script = `node -e "const fs=require('fs');const p=process.env.HOME+'/.openclaw/openclaw.json';const c=JSON.parse(fs.readFileSync(p,'utf8'));c.channels=c.channels||{};c.channels.whatsapp=c.channels.whatsapp||{};c.channels.whatsapp.allowFrom=[process.env.WA_PHONE];delete c.channels.whatsapp.allowList;fs.writeFileSync(p,JSON.stringify(c,null,2));"`;
    try {
      const result = await window.electron.execCommand('/bin/zsh', ['-l', '-c', script], {
        shell: false,
        env: { HOME, WA_PHONE: whatsappPhone.trim() },
      });
      if (result.exitCode === 0) setWhatsappAllowSaved(true);
    } catch { /* non-fatal */ }
  }, [whatsappPhone]);

  // ─── Save bot identity to workspace markdown files ────────────────
  // OpenClaw reads IDENTITY.md / SOUL.md / USER.md from the workspace on startup.
  // Do NOT write name/instructions/memoryInstructions to agents.defaults — those
  // keys are not in the schema and cause a config-invalid error.
  const saveBotIdentity = useCallback(async () => {
    setIdentitySavedStatus('saving');
    const cleanupScript = `node -e "const fs=require('fs');const p=process.env.HOME+'/.openclaw/openclaw.json';const c=JSON.parse(fs.readFileSync(p,'utf8'));if(c.agents&&c.agents.defaults){delete c.agents.defaults.name;delete c.agents.defaults.instructions;delete c.agents.defaults.memoryInstructions;}delete c.agent;fs.writeFileSync(p,JSON.stringify(c,null,2));"`;
    const workspaceScript = `node -e "
const fs=require('fs');
const ws=process.env.HOME+'/.openclaw/workspace';
fs.mkdirSync(ws,{recursive:true});
const name=process.env.BOT_NAME;
const personality=process.env.BOT_PERSONALITY;
const memory=process.env.BOT_MEMORY;
if(name){fs.writeFileSync(ws+'/IDENTITY.md','# IDENTITY.md - Who Am I?\\n\\n- **Name:** '+name+'\\n- **Creature:** AI assistant\\n- **Vibe:** helpful, concise, honest\\n\\n---\\n\\nThis file defines your identity.\\n');}
if(personality){let soul='';try{soul=fs.readFileSync(ws+'/SOUL.md','utf8');}catch(e){}soul=soul.replace(/\\n---\\n## Custom Instructions[\\s\\S]*$/,'');soul+='\\n---\\n## Custom Instructions\\n\\n'+personality+'\\n';fs.writeFileSync(ws+'/SOUL.md',soul);}
if(memory){let user='';try{user=fs.readFileSync(ws+'/USER.md','utf8');}catch(e){}user=user.replace(/\\n---\\n## Memory Notes[\\s\\S]*$/,'');user+='\\n---\\n## Memory Notes\\n\\n'+memory+'\\n';fs.writeFileSync(ws+'/USER.md',user);}
"`;
    try {
      // Step 1: remove invalid keys from openclaw.json
      await window.electron.execCommand('/bin/zsh', ['-l', '-c', cleanupScript], { shell: false, env: { HOME } });
      // Step 2: write to workspace markdown files
      const result = await window.electron.execCommand('/bin/zsh', ['-l', '-c', workspaceScript], {
        shell: false,
        env: { HOME, BOT_NAME: botName, BOT_PERSONALITY: botPersonality, BOT_MEMORY: botMemory },
      });
      setIdentitySavedStatus(result.exitCode === 0 ? 'saved' : 'error');
    } catch {
      setIdentitySavedStatus('error');
    }
  }, [botName, botPersonality, botMemory]);

  // ─── Gateway ──────────────────────────────────────────────────────
  const checkGatewayStatus = useCallback(async () => {
    setGatewayCheckLoading(true);
    try {
      const result = await loginShellExec('openclaw gateway status 2>&1');
      const out = (result.stdout + result.stderr).toLowerCase();
      setGatewayStatus(result.exitCode === 0 || out.includes('running') || out.includes('healthy') ? 'running' : 'stopped');
    } catch {
      setGatewayStatus('stopped');
    } finally {
      setGatewayCheckLoading(false);
    }
  }, []);

  // ─── Repair config (run openclaw doctor --fix) ────────────────────
  const runFixConfig = useCallback(async () => {
    setFixConfigStatus('running');
    try {
      const result = await loginShellExec('openclaw doctor --fix 2>&1');
      setFixConfigStatus(result.exitCode === 0 ? 'done' : 'error');
    } catch {
      setFixConfigStatus('error');
    }
  }, []);

  // ─── Uninstall OpenClaw ───────────────────────────────────────────
  const runUninstall = useCallback(async () => {
    setUninstallStatus('running');
    try {
      setUninstallStep('Stopping gateway…');
      await loginShellExec('openclaw gateway stop 2>/dev/null || true');

      setUninstallStep('Removing daemon…');
      await loginShellExec('openclaw daemon uninstall 2>/dev/null || true');

      setUninstallStep('Uninstalling OpenClaw CLI…');
      await loginShellExec('npm uninstall -g openclaw 2>/dev/null || true');

      if (deleteData) {
        setUninstallStep('Deleting data and config…');
        await window.electron.execCommand(
          '/bin/zsh', ['-l', '-c', 'rm -rf "$HOME/.openclaw"'],
          { shell: false, env: { HOME } },
        );
      }

      // Clear SuperCmd state
      localStorage.removeItem('openclaw_setup_done');
      localStorage.removeItem('openclaw_wizard_step');
      setUninstallStatus('done');
    } catch {
      setUninstallStatus('error');
      setUninstallStep('');
    }
  }, [deleteData]);

  // ─── Send test/welcome message via Telegram ───────────────────────
  // The gateway consumes Telegram getUpdates internally (long-polling), so
  // getUpdates from the wizard returns empty while the gateway is running.
  // Fix: first check allowFrom in the config for already-paired numeric IDs.
  // Only fall back to getUpdates if no known IDs (handles pre-gateway or
  // pairing-code flows). Also auto-approves any pending pairing codes found.
  const sendTestMessage = useCallback(async () => {
    if (!telegramToken.trim()) return;
    setTestMsgStatus('checking');
    setTestMsgError('');
    try {
      // Step 1: read numeric IDs already approved (allowFrom) from config
      const readConfigScript = `node -e "const fs=require('fs');try{const c=JSON.parse(fs.readFileSync(process.env.HOME+'/.openclaw/openclaw.json','utf8'));const af=(c.channels&&c.channels.telegram&&c.channels.telegram.allowFrom)||[];const nums=af.filter(v=>typeof v==='number'||/^\\d+$/.test(String(v)));console.log(JSON.stringify(nums));}catch(e){console.log('[]');}"`;
      const cfgResult = await window.electron.execCommand('/bin/zsh', ['-l', '-c', readConfigScript], { shell: false, env: { HOME } });
      let knownIds: number[] = [];
      try { knownIds = JSON.parse(cfgResult.stdout.trim()) as number[]; } catch { /* ignore */ }

      let chatId: number | null = knownIds.length > 0 ? Number(knownIds[0]) : null;

      // Step 2: if no known IDs, try getUpdates to find /start or pairing code
      if (!chatId) {
        const getUpdatesScript = `node -e "const https=require('https');let body='';https.get('https://api.telegram.org/bot'+process.env.BOT_TOKEN+'/getUpdates?limit=100&offset=-100',(res)=>{res.on('data',(c)=>body+=c);res.on('end',()=>{process.stdout.write(body);process.exit(0);});}).on('error',()=>process.exit(1));"`;
        const updResult = await window.electron.execCommand('/bin/zsh', ['-l', '-c', getUpdatesScript], {
          shell: false, env: { HOME, BOT_TOKEN: telegramToken.trim() },
        });
        if (updResult.exitCode === 0) {
          let pairingCode: string | null = null;
          try {
            type TgUpdate = { message?: { chat?: { id: number }; text?: string }; callback_query?: { message?: { chat?: { id: number } } } };
            const data = JSON.parse(updResult.stdout) as { ok: boolean; result: TgUpdate[] };
            if (data.ok && data.result.length > 0) {
              for (const upd of [...data.result].reverse()) {
                const msg = upd.message ?? upd.callback_query?.message;
                if (msg?.chat?.id) {
                  chatId = msg.chat.id;
                  const match = upd.message?.text?.match(/Pairing code:\s*([A-Z0-9]{6,12})/i);
                  if (match) pairingCode = match[1];
                  break;
                }
              }
            }
          } catch { /* ignore parse errors */ }

          if (pairingCode && chatId) {
            // Auto-approve the pairing
            const approveResult = await loginShellExec(`openclaw pairing approve telegram ${pairingCode} 2>&1`);
            if (approveResult.exitCode === 0 || approveResult.stdout.toLowerCase().includes('approved')) {
              // Persist the numeric ID to allowFrom so future sends skip getUpdates
              const saveScript = `node -e "const fs=require('fs');const p=process.env.HOME+'/.openclaw/openclaw.json';const c=JSON.parse(fs.readFileSync(p,'utf8'));c.channels=c.channels||{};c.channels.telegram=c.channels.telegram||{};const af=c.channels.telegram.allowFrom||[];const id=parseInt(process.env.CHAT_ID);if(!af.includes(id))af.push(id);c.channels.telegram.allowFrom=af;delete c.channels.telegram.allowList;fs.writeFileSync(p,JSON.stringify(c,null,2));"`;
              await window.electron.execCommand('/bin/zsh', ['-l', '-c', saveScript], {
                shell: false, env: { HOME, CHAT_ID: String(chatId) },
              }).catch(() => {});
              await new Promise((r) => setTimeout(r, 1200));
            }
          }
        }
      }

      if (!chatId) {
        setTestMsgStatus('error');
        setTestMsgError(`Not paired yet. Open Telegram, message @${telegramBotUsername ?? 'your bot'}, tap Start — the bot will reply with a pairing code. Click Send again after that.`);
        return;
      }

      setTestMsgStatus('sending');
      const welcomeText = `👋 Hi! I'm your AI assistant, configured via SuperCmd on your Mac.\n\nI'm powered by OpenClaw and ready to help. Try asking me anything!`;
      const sendScript = `node -e "const https=require('https');const payload=JSON.stringify({chat_id:parseInt(process.env.CHAT_ID),text:process.env.MSG_TEXT});const opts={hostname:'api.telegram.org',path:'/bot'+process.env.BOT_TOKEN+'/sendMessage',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}};const req=https.request(opts,(res)=>{let b='';res.on('data',(c)=>b+=c);res.on('end',()=>{try{const r=JSON.parse(b);process.exit(r.ok?0:1);}catch{process.exit(1);}});});req.on('error',()=>process.exit(1));req.write(payload);req.end();"`;
      const sendResult = await window.electron.execCommand('/bin/zsh', ['-l', '-c', sendScript], {
        shell: false,
        env: { HOME, BOT_TOKEN: telegramToken.trim(), CHAT_ID: String(chatId), MSG_TEXT: welcomeText },
      });
      if (sendResult.exitCode === 0) {
        setTestMsgStatus('sent');
      } else {
        setTestMsgStatus('error');
        setTestMsgError('Message send failed. Make sure the gateway is running and the bot token is correct.');
      }
    } catch {
      setTestMsgStatus('error');
      setTestMsgError('Something went wrong sending the test message.');
    }
  }, [telegramToken, telegramBotUsername]);

  const startGateway = useCallback(async () => {
    setGatewayStartStatus('running');
    try {
      const { pid } = await window.electron.spawnProcess(
        '/bin/zsh',
        ['-l', '-c', 'openclaw gateway --port 18789'],
        { shell: false, env: LOGIN_ENV },
      );
      gatewaySpawnPid.current = pid;
      setGatewayStartStatus('done');
      let attempts = 0;
      gatewayPollRef.current = setInterval(async () => {
        attempts++;
        await checkGatewayStatus();
        if (attempts >= 15 && gatewayPollRef.current != null) {
          clearInterval(gatewayPollRef.current);
          gatewayPollRef.current = null;
        }
      }, 2000);
    } catch {
      setGatewayStartStatus('error');
    }
  }, [checkGatewayStatus]);

  // ─── Navigation helpers ───────────────────────────────────────────
  const canGoNext = () => {
    if (step === 1) return safetyAcknowledged;                                            // Safety gate
    if (step === 2) return prereqChecked && nodeStatus !== 'running';                     // Prerequisites
    if (step === 3) return installStatus === 'done' || openClawInstalled === true;         // Install (broken blocks until reinstalled)
    if (step === 4) return onboardStatus === 'done' || onboardStatus === 'error';         // Onboard
    return true;
  };

  // Auto-saves any filled-in data before advancing so nothing is lost if the user
  // skips the explicit "Save" button and just clicks Continue.
  const goNext = async () => {
    if (step >= STEPS.length - 1 || !canGoNext()) return;
    try {
      if (step === 5 && apiKey.trim().length > 10 && apiKeySaveStatus !== 'saved') {
        await saveApiKey();
      }
      if (step === 6 && (botName || botPersonality || botMemory) && identitySavedStatus !== 'saved') {
        await saveBotIdentity();
      }
      if (step === 7) {
        if (telegramToken.trim().length > 10 && telegramSaveStatus !== 'saved') {
          await saveTelegramToken();
          if (telegramPhone.trim()) await saveTelegramAllowList();
        }
      }
    } catch { /* non-fatal — advance even if save fails */ }
    setStep((s) => s + 1);
  };

  // Skip: advance without triggering auto-save (intentional skip)
  const skipStep = () => setStep((s) => s + 1);

  const goBack = () => {
    if (step > 0) setStep((s) => s - 1);
  };

  // ─── Shared UI components ─────────────────────────────────────────
  const StatusBadge: React.FC<{ status: StepStatus | null; label?: string }> = ({ status, label }) => {
    if (status === 'done')
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border border-emerald-200/35 bg-emerald-500/22 text-emerald-100">
          <Check className="w-3 h-3" />{label || 'Done'}
        </span>
      );
    if (status === 'error')
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px]" style={{ borderWidth: 1, borderStyle: 'solid', borderColor: BRAND.redBorder, background: BRAND.redDim, color: '#fca5a5' }}>
          <XCircle className="w-3 h-3" />{label || 'Error'}
        </span>
      );
    if (status === 'running')
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border border-amber-200/30 bg-amber-500/20 text-amber-100">
          <Loader2 className="w-3 h-3 animate-spin" />{label || 'Running…'}
        </span>
      );
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] border border-white/20 bg-white/[0.06] text-white/50">
        <Circle className="w-3 h-3 mr-1" />{label || 'Pending'}
      </span>
    );
  };

  const TerminalPanel: React.FC<{ lines: string[]; panelRef: React.RefObject<HTMLPreElement> }> = ({ lines, panelRef }) => (
    <pre
      ref={panelRef}
      className="w-full h-[220px] overflow-y-auto rounded-xl px-4 py-3 text-[11px] font-mono leading-relaxed whitespace-pre-wrap"
      style={{ background: '#0a0c10', border: '1px solid rgba(234,70,71,0.20)', color: '#f9a8a8', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
    >
      {lines.join('')}
    </pre>
  );

  // OpenClaw icon — uses CDN icon, falls back to claw emoji
  const OpenClawIcon: React.FC<{ size?: number; className?: string }> = ({ size = 32, className = '' }) => (
    logoError ? (
      <span style={{ fontSize: size * 0.8, lineHeight: 1 }}>🦞</span>
    ) : (
      <img
        src={OPENCLAW_ICON_URL}
        alt="OpenClaw"
        width={size}
        height={size}
        className={`object-contain ${className}`}
        onError={() => setLogoError(true)}
        draggable={false}
      />
    )
  );

  // ─── Step backgrounds / colors ────────────────────────────────────
  const bodyBg = `radial-gradient(circle at 8% 0%, rgba(234,70,71,0.16), transparent 38%), radial-gradient(circle at 94% 8%, rgba(200,50,50,0.10), transparent 42%), ${BRAND.bg}`;

  // ─── Settings mode (shown when wizard is already complete) ──────
  if (mode === 'settings') {
    return (
      <div className="w-full h-full">
        <div className="overflow-hidden h-full flex flex-col" style={{ background: `linear-gradient(140deg, rgba(5,8,17,0.96) 0%, rgba(10,8,12,0.98) 52%, rgba(14,6,6,0.96) 100%)`, WebkitBackdropFilter: 'blur(50px) saturate(160%)', backdropFilter: 'blur(50px) saturate(160%)' }}>
          {/* Header */}
          <div className="flex items-center gap-3 px-6 py-4" style={{ borderBottom: '1px solid rgba(234,70,71,0.15)' }}>
            <button onClick={onClose} className="text-white/30 hover:text-white/75 transition-colors p-0.5"><ArrowLeft className="w-4 h-4" /></button>
            <div className="flex items-center gap-2.5 flex-1 min-w-0">
              <OpenClawIcon size={26} />
              <div>
                <div className="text-white/92 text-[14px] font-semibold leading-none">OpenClaw Settings</div>
                <div className="text-white/38 text-[11px] mt-0.5">Manage your assistant</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={runFixConfig}
                disabled={fixConfigStatus === 'running'}
                title="Run openclaw doctor --fix to clean up invalid config keys"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border border-white/15 bg-white/[0.07] text-white/55 hover:text-white/80 hover:bg-white/[0.12] transition-colors disabled:opacity-40"
              >
                {fixConfigStatus === 'running' ? <><Loader2 className="w-3 h-3 animate-spin" /> Repairing…</>
                  : fixConfigStatus === 'done' ? <><Check className="w-3 h-3 text-emerald-400" /> Config Fixed</>
                  : fixConfigStatus === 'error' ? <><XCircle className="w-3 h-3 text-red-400" /> Fix Failed</>
                  : 'Repair Config'}
              </button>
              <button
                onClick={() => { setMode('wizard'); setStep(0); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border border-white/15 bg-white/[0.07] text-white/55 hover:text-white/80 hover:bg-white/[0.12] transition-colors"
              >
                Re-run Setup Wizard
              </button>
            </div>
          </div>

          {/* Settings sections */}
          <div className="flex-1 overflow-y-auto px-6 py-5" style={{ background: bodyBg }}>
            <div className="max-w-2xl mx-auto space-y-3">

              {/* Gateway status card */}
              <div
                className="rounded-2xl p-4 flex items-center justify-between"
                style={{ border: `1px solid ${gatewayStatus === 'running' ? 'rgba(110,231,183,0.35)' : BRAND.redBorder}`, background: gatewayStatus === 'running' ? 'rgba(16,185,129,0.08)' : BRAND.redDim }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: gatewayStatus === 'running' ? '#34d399' : BRAND.red, boxShadow: gatewayStatus === 'running' ? '0 0 6px rgba(52,211,153,0.8)' : `0 0 6px ${BRAND.redGlow}` }} />
                  <div>
                    <p className="text-white/88 text-sm font-medium">Gateway {gatewayStatus === 'running' ? 'running' : 'not running'}</p>
                    <p className="text-white/45 text-[11px]">localhost:18789</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={checkGatewayStatus} disabled={gatewayCheckLoading} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-white/15 bg-white/[0.07] text-white/55 text-xs hover:bg-white/[0.12] transition-colors disabled:opacity-40">
                    {gatewayCheckLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Refresh'}
                  </button>
                  {gatewayStatus === 'running' && (
                    <button onClick={() => window.electron.openUrl(gatewayToken ? `http://127.0.0.1:18789/?token=${encodeURIComponent(gatewayToken)}` : 'http://127.0.0.1:18789/')} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-white transition-colors" style={{ border: `1px solid ${BRAND.redBorder}`, background: 'rgba(234,70,71,0.22)' }}>
                      Open Dashboard <ExternalLink className="w-3 h-3" />
                    </button>
                  )}
                  {gatewayStatus !== 'running' && (
                    <button onClick={startGateway} disabled={gatewayStartStatus === 'running'} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-white transition-colors disabled:opacity-55" style={{ border: `1px solid ${BRAND.redBorder}`, background: BRAND.redDim }}>
                      {gatewayStartStatus === 'running' ? <><Loader2 className="w-3 h-3 animate-spin" /> Starting…</> : <><Zap className="w-3 h-3" /> Start</>}
                    </button>
                  )}
                </div>
              </div>

              {/* Settings nav tabs */}
              <div className="flex gap-1 rounded-xl p-1" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
                {([
                  { id: 'api', label: 'AI Provider' },
                  { id: 'bot', label: 'Your Bot' },
                  { id: 'channels', label: 'Channels' },
                  { id: 'skills', label: 'Skills' },
                  { id: 'security', label: 'Security' },
                ] as const).map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setSettingsSection(tab.id)}
                    className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-all"
                    style={{
                      background: settingsSection === tab.id ? BRAND.redDim : 'transparent',
                      border: settingsSection === tab.id ? `1px solid ${BRAND.redBorder}` : '1px solid transparent',
                      color: settingsSection === tab.id ? '#fca5a5' : 'rgba(255,255,255,0.45)',
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* AI Provider section */}
              {settingsSection === 'api' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    {([
                      { id: 'anthropic' as const, name: 'Anthropic Claude', desc: 'Claude Sonnet & Opus', prefix: 'sk-ant-', docsUrl: 'https://console.anthropic.com/settings/keys' },
                      { id: 'openai' as const, name: 'OpenAI', desc: 'GPT-4o and others', prefix: 'sk-', docsUrl: 'https://platform.openai.com/api-keys' },
                    ]).map((p) => (
                      <button key={p.id} onClick={() => { setSelectedProvider(p.id); setApiKey(''); setApiKeySaveStatus('idle'); setSelectedModel(MODELS[p.id][0].id); }} className="rounded-2xl p-4 text-left transition-all" style={{ border: selectedProvider === p.id ? `1px solid ${BRAND.redBorder}` : '1px solid rgba(255,255,255,0.10)', background: selectedProvider === p.id ? BRAND.redDim : 'rgba(255,255,255,0.04)' }}>
                        <p className="text-white/90 text-sm font-semibold">{p.name}</p>
                        <p className="text-white/48 text-xs mt-0.5">{p.desc}</p>
                      </button>
                    ))}
                  </div>
                  <div className="relative">
                    <input type={apiKeyVisible ? 'text' : 'password'} value={apiKey} onChange={(e) => { setApiKey(e.target.value); setApiKeySaveStatus('idle'); }} placeholder={selectedProvider === 'anthropic' ? 'sk-ant-…' : 'sk-…'} className="w-full rounded-xl px-4 py-3 text-sm font-mono pr-11 outline-none" style={{ background: '#0a0c10', border: `1px solid ${apiKeySaveStatus === 'saved' ? 'rgba(110,231,183,0.40)' : 'rgba(255,255,255,0.14)'}`, color: '#fca5a5' }} />
                    <button onClick={() => setApiKeyVisible((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/35 hover:text-white/65">{apiKeyVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                  </div>
                  {apiKey.trim().length > 10 && apiKeySaveStatus !== 'saved' && (
                    <button onClick={saveApiKey} disabled={apiKeySaveStatus === 'saving'} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm text-white disabled:opacity-50" style={{ border: `1px solid ${BRAND.redBorder}`, background: BRAND.redDim }}>
                      {apiKeySaveStatus === 'saving' ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <><Check className="w-4 h-4" /> Save API Key</>}
                    </button>
                  )}
                  {apiKeySaveStatus === 'saved' && (
                    <div className="flex items-center gap-2 rounded-xl px-4 py-3" style={{ border: '1px solid rgba(110,231,183,0.35)', background: 'rgba(16,185,129,0.10)' }}>
                      <CheckCircle className="w-4 h-4 text-emerald-300" />
                      <p className="text-emerald-100/90 text-sm">API key updated!</p>
                    </div>
                  )}
                  {/* Model selector */}
                  <div className="space-y-2">
                    <p className="text-white/60 text-xs font-medium">Model</p>
                    <div className="grid grid-cols-1 gap-1.5">
                      {MODELS[selectedProvider].map((m) => (
                        <button key={m.id} onClick={() => setSelectedModel(m.id)} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all" style={{ border: selectedModel === m.id ? `1px solid ${BRAND.redBorder}` : '1px solid rgba(255,255,255,0.09)', background: selectedModel === m.id ? BRAND.redDim : 'rgba(255,255,255,0.03)' }}>
                          <div className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center ${selectedModel === m.id ? 'border-red-400' : 'border-white/25'}`}>
                            {selectedModel === m.id && <div className="w-1.5 h-1.5 rounded-full bg-red-400" />}
                          </div>
                          <span className="text-white/80 text-xs flex-1">{m.label}</span>
                          {m.recommended && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ border: `1px solid ${BRAND.redBorder}`, background: BRAND.redDim, color: '#fca5a5' }}>Recommended</span>}
                        </button>
                      ))}
                    </div>
                    {apiKey.trim().length > 10 && (
                      <button onClick={saveApiKey} disabled={apiKeySaveStatus === 'saving'} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium text-xs text-white disabled:opacity-50 mt-1" style={{ border: `1px solid ${BRAND.redBorder}`, background: BRAND.redDim }}>
                        {apiKeySaveStatus === 'saving' ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</> : <><Check className="w-3.5 h-3.5" /> Apply Model Change</>}
                      </button>
                    )}
                  </div>
                  <button onClick={() => window.electron.openUrl(selectedProvider === 'anthropic' ? 'https://console.anthropic.com/settings/keys' : 'https://platform.openai.com/api-keys')} className="inline-flex items-center gap-1.5 text-xs" style={{ color: 'rgba(252,165,165,0.65)' }}>
                    Get / view your key <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              )}

              {/* Your Bot section */}
              {settingsSection === 'bot' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-white/75 text-sm font-medium">Bot name</label>
                    <input type="text" value={botName} onChange={(e) => { setBotName(e.target.value); setIdentitySavedStatus('idle'); }} placeholder="e.g. Alex, Aria, Friday" className="w-full rounded-xl px-4 py-3 text-sm outline-none" style={{ background: '#0a0c10', border: '1px solid rgba(255,255,255,0.14)', color: 'white' }} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-white/75 text-sm font-medium">Personality / instructions</label>
                    <textarea value={botPersonality} onChange={(e) => { setBotPersonality(e.target.value); setIdentitySavedStatus('idle'); }} placeholder="Be concise and friendly. Always respond in English..." rows={3} className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none" style={{ background: '#0a0c10', border: '1px solid rgba(255,255,255,0.14)', color: 'white' }} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-white/75 text-sm font-medium">Permanent memory</label>
                    <textarea value={botMemory} onChange={(e) => { setBotMemory(e.target.value); setIdentitySavedStatus('idle'); }} placeholder="My name is Sam. I live in London. My work email is..." rows={3} className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none" style={{ background: '#0a0c10', border: '1px solid rgba(255,255,255,0.14)', color: 'white' }} />
                    <p className="text-white/35 text-[11px]">This is always included when your assistant processes your requests.</p>
                  </div>
                  {(botName || botPersonality || botMemory) && identitySavedStatus !== 'saved' && (
                    <button onClick={saveBotIdentity} disabled={identitySavedStatus === 'saving'} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm text-white disabled:opacity-50" style={{ border: `1px solid ${BRAND.redBorder}`, background: BRAND.redDim }}>
                      {identitySavedStatus === 'saving' ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <><Check className="w-4 h-4" /> Save Bot Settings</>}
                    </button>
                  )}
                  {identitySavedStatus === 'saved' && <div className="flex items-center gap-2 rounded-xl px-4 py-3" style={{ border: '1px solid rgba(110,231,183,0.35)', background: 'rgba(16,185,129,0.10)' }}><CheckCircle className="w-4 h-4 text-emerald-300" /><p className="text-emerald-100/90 text-sm">Saved!</p></div>}
                </div>
              )}

              {/* Channels section */}
              {settingsSection === 'channels' && (
                <div className="space-y-3">
                  {[
                    { id: 'telegram', title: 'Telegram', badge: 'Easiest', badgeStyle: { border: '1px solid rgba(110,231,183,0.35)', background: 'rgba(16,185,129,0.18)', color: '#6ee7b7' }, url: 'https://docs.openclaw.ai/channels/telegram' },
                    { id: 'whatsapp', title: 'WhatsApp', badge: null, badgeStyle: {}, url: 'https://docs.openclaw.ai/channels/whatsapp' },
                    { id: 'imessage', title: 'iMessage', badge: 'macOS', badgeStyle: { border: `1px solid ${BRAND.redBorder}`, background: BRAND.redDim, color: '#fca5a5' }, url: 'https://docs.openclaw.ai/channels/imessage' },
                    { id: 'discord', title: 'Discord', badge: null, badgeStyle: {}, url: 'https://docs.openclaw.ai/channels/discord' },
                    { id: 'signal', title: 'Signal', badge: null, badgeStyle: {}, url: 'https://docs.openclaw.ai/channels/signal' },
                    { id: 'slack', title: 'Slack', badge: null, badgeStyle: {}, url: 'https://docs.openclaw.ai/channels/slack' },
                  ].map((ch) => (
                    <div key={ch.id} className="rounded-2xl p-4 flex items-center justify-between" style={{ border: '1px solid rgba(234,70,71,0.16)', background: 'rgba(255,255,255,0.04)' }}>
                      <div className="flex items-center gap-2">
                        <p className="text-white/80 text-sm font-medium">{ch.title}</p>
                        {ch.badge && <span className="inline-flex px-1.5 py-0.5 rounded-full text-[10px]" style={ch.badgeStyle}>{ch.badge}</span>}
                      </div>
                      <button onClick={() => window.electron.openUrl(ch.url)} className="inline-flex items-center gap-1 text-xs" style={{ color: 'rgba(252,165,165,0.65)' }}>
                        Guide <ExternalLink className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  <p className="text-white/35 text-[11px] text-center mt-2">Full channel management is available in the OpenClaw dashboard → Channels.</p>
                </div>
              )}

              {/* Skills section */}
              {settingsSection === 'skills' && (
                <div className="space-y-3">
                  <div className="rounded-2xl p-4 space-y-3" style={{ border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)' }}>
                    <p className="text-white/80 text-sm font-medium">Install new skills</p>
                    <p className="text-white/50 text-xs leading-relaxed">Skills give your assistant new abilities — web search, code execution, calendar access, file management, and more.</p>
                    <button onClick={() => window.electron.openUrl(gatewayToken ? `http://127.0.0.1:18789/?token=${encodeURIComponent(gatewayToken)}` : 'http://127.0.0.1:18789/')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-white transition-colors" style={{ border: `1px solid ${BRAND.redBorder}`, background: BRAND.redDim }}>
                      Open Dashboard → Skills <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="rounded-2xl p-4 space-y-2" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
                    <p className="text-white/60 text-xs font-medium">Common skills to try:</p>
                    <div className="grid grid-cols-2 gap-2">
                      {['Web Search', 'Code Execution', 'File Management', 'Calendar', 'Email (Gmail)', 'Weather'].map((skill) => (
                        <div key={skill} className="rounded-lg px-3 py-2" style={{ background: 'rgba(234,70,71,0.08)', border: `1px solid ${BRAND.redBorder}` }}>
                          <p className="text-white/70 text-xs">{skill}</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-white/35 text-[11px] mt-2">Browse and install all available skills from the dashboard.</p>
                  </div>
                </div>
              )}

              {/* Security section */}
              {settingsSection === 'security' && (
                <div className="space-y-3">
                  {/* Doctor */}
                  <div className="rounded-2xl p-4 space-y-3" style={{ border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)' }}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-white/80 text-sm font-medium">Health Check</p>
                        <p className="text-white/45 text-[11px] mt-0.5">Runs <code className="text-white/60">openclaw doctor</code> — checks gateway, channels, skills, and sessions.</p>
                      </div>
                      <button
                        onClick={async () => {
                          setDoctorStatus('running');
                          setDoctorOutput('');
                          try {
                            const res = await openclawExec('doctor');
                            setDoctorOutput(res.stdout || res.stderr || '(no output)');
                            setDoctorStatus('done');
                          } catch (e) {
                            setDoctorOutput(String(e));
                            setDoctorStatus('error');
                          }
                        }}
                        disabled={doctorStatus === 'running'}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white shrink-0 disabled:opacity-50 transition-colors"
                        style={{ border: `1px solid ${BRAND.redBorder}`, background: BRAND.redDim }}
                      >
                        {doctorStatus === 'running' ? <><Loader2 className="w-3 h-3 animate-spin" /> Running…</> : <><Shield className="w-3 h-3" /> Run Doctor</>}
                      </button>
                    </div>
                    {doctorOutput && (
                      <pre className="rounded-xl px-3 py-2.5 text-[11px] leading-relaxed overflow-auto max-h-48 whitespace-pre-wrap" style={{ background: '#0a0c10', border: '1px solid rgba(255,255,255,0.10)', color: doctorStatus === 'error' ? '#fca5a5' : 'rgba(255,255,255,0.70)', fontFamily: 'monospace' }}>
                        {doctorOutput}
                      </pre>
                    )}
                  </div>

                  {/* Security audit */}
                  <div className="rounded-2xl p-4 space-y-3" style={{ border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)' }}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-white/80 text-sm font-medium">Security Audit</p>
                        <p className="text-white/45 text-[11px] mt-0.5">Runs <code className="text-white/60">openclaw security audit --deep</code> — scans for misconfigurations, open access policies, and attack surface issues.</p>
                      </div>
                      <button
                        onClick={async () => {
                          setAuditStatus('running');
                          setAuditOutput('');
                          try {
                            const res = await openclawExec('security audit --deep');
                            setAuditOutput(res.stdout || res.stderr || '(no output)');
                            setAuditStatus(res.exitCode === 0 ? 'done' : 'error');
                          } catch (e) {
                            setAuditOutput(String(e));
                            setAuditStatus('error');
                          }
                        }}
                        disabled={auditStatus === 'running'}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white shrink-0 disabled:opacity-50 transition-colors"
                        style={{ border: `1px solid ${BRAND.redBorder}`, background: BRAND.redDim }}
                      >
                        {auditStatus === 'running' ? <><Loader2 className="w-3 h-3 animate-spin" /> Running…</> : <><ShieldAlert className="w-3 h-3" /> Run Audit</>}
                      </button>
                    </div>
                    {auditOutput && (() => {
                      // Parse "Summary: X critical · Y warn · Z info" from the output
                      const summaryMatch = auditOutput.match(/Summary:\s*(\d+)\s*critical\s*·\s*(\d+)\s*warn/i);
                      const critical = summaryMatch ? parseInt(summaryMatch[1]) : null;
                      const warnings = summaryMatch ? parseInt(summaryMatch[2]) : null;
                      const allClear = critical === 0 && warnings === 0;
                      const noIssues = critical === 0;
                      return (
                        <>
                          <pre className="rounded-xl px-3 py-2.5 text-[11px] leading-relaxed overflow-auto max-h-60 whitespace-pre-wrap" style={{ background: '#0a0c10', border: `1px solid ${auditStatus === 'error' ? 'rgba(234,70,71,0.30)' : 'rgba(255,255,255,0.10)'}`, color: auditStatus === 'error' ? '#fca5a5' : 'rgba(255,255,255,0.70)', fontFamily: 'monospace' }}>
                            {auditOutput}
                          </pre>
                          {auditStatus === 'done' && allClear && (
                            <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ border: '1px solid rgba(110,231,183,0.35)', background: 'rgba(16,185,129,0.12)' }}>
                              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                              <div>
                                <p className="text-emerald-100/90 text-xs font-medium">No issues found</p>
                                <p className="text-emerald-100/55 text-[11px] mt-0.5">Your setup is clean — 0 critical, 0 warnings.</p>
                              </div>
                            </div>
                          )}
                          {auditStatus === 'done' && !allClear && noIssues && (
                            <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ border: '1px solid rgba(251,191,36,0.35)', background: 'rgba(245,158,11,0.10)' }}>
                              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                              <div>
                                <p className="text-amber-100/90 text-xs font-medium">No critical issues — {warnings} warning{warnings !== 1 ? 's' : ''} to review</p>
                                <p className="text-amber-100/55 text-[11px] mt-0.5">Check the output above and consider addressing the warnings.</p>
                              </div>
                            </div>
                          )}
                          {auditStatus === 'done' && !noIssues && (
                            <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ border: `1px solid ${BRAND.redBorder}`, background: BRAND.redDim }}>
                              <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                              <div>
                                <p className="text-red-100/90 text-xs font-medium">{critical} critical issue{critical !== 1 ? 's' : ''} found</p>
                                <p className="text-red-100/55 text-[11px] mt-0.5">Review the output above and fix critical items before going live.</p>
                              </div>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* ── Danger Zone ── always visible at the bottom */}
              <div className="rounded-2xl p-4 space-y-3 mt-2" style={{ border: '1px solid rgba(239,68,68,0.20)', background: 'rgba(239,68,68,0.04)' }}>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: 'rgba(248,113,113,0.70)' }} />
                  <p className="text-red-300/70 text-sm font-semibold">Danger Zone</p>
                </div>

                {uninstallStatus === 'idle' && !showUninstallConfirm && (
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-white/60 text-xs font-medium">Uninstall OpenClaw</p>
                      <p className="text-white/35 text-[11px] mt-0.5">Stops the gateway, removes the daemon, and uninstalls the CLI from your Mac.</p>
                    </div>
                    <button
                      onClick={() => setShowUninstallConfirm(true)}
                      className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                      style={{ border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.12)', color: 'rgba(252,165,165,0.80)' }}
                    >
                      <Trash2 className="w-3 h-3" /> Uninstall
                    </button>
                  </div>
                )}

                {uninstallStatus === 'idle' && showUninstallConfirm && (
                  <div className="space-y-3">
                    <p className="text-red-300/80 text-xs font-medium">This will:</p>
                    <ul className="space-y-1 pl-1">
                      {[
                        'Stop the OpenClaw gateway process',
                        'Remove the macOS LaunchAgent daemon',
                        'Uninstall the openclaw CLI (npm uninstall -g)',
                      ].map((item) => (
                        <li key={item} className="flex items-center gap-2 text-red-300/65 text-[11px]">
                          <span style={{ color: 'rgba(248,113,113,0.60)' }}>•</span> {item}
                        </li>
                      ))}
                    </ul>
                    <label className="flex items-start gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={deleteData}
                        onChange={(e) => setDeleteData(e.target.checked)}
                        className="mt-0.5 shrink-0 rounded"
                      />
                      <span className="text-red-300/65 text-[11px] leading-relaxed">
                        Also delete my config and data (<code className="font-mono">~/.openclaw/</code>) — this cannot be undone
                      </span>
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => void runUninstall()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                        style={{ border: '1px solid rgba(239,68,68,0.50)', background: 'rgba(239,68,68,0.20)', color: 'rgba(252,165,165,0.90)' }}
                      >
                        <Trash2 className="w-3 h-3" /> Yes, uninstall everything
                      </button>
                      <button
                        onClick={() => { setShowUninstallConfirm(false); setDeleteData(false); }}
                        className="px-3 py-1.5 rounded-md text-xs text-white/40 hover:text-white/65 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {uninstallStatus === 'running' && (
                  <div className="flex items-center gap-2 text-white/55 text-xs">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'rgba(248,113,113,0.70)' }} />
                    {uninstallStep}
                  </div>
                )}

                {uninstallStatus === 'done' && (
                  <div className="rounded-xl px-3 py-2.5 flex items-start gap-2" style={{ border: '1px solid rgba(110,231,183,0.35)', background: 'rgba(16,185,129,0.10)' }}>
                    <CheckCircle className="w-4 h-4 text-emerald-300 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-emerald-100/90 text-xs font-medium">OpenClaw uninstalled</p>
                      <p className="text-emerald-100/60 text-[11px] mt-0.5">Gateway stopped, daemon removed, CLI uninstalled. You can close this window.</p>
                    </div>
                  </div>
                )}

                {uninstallStatus === 'error' && (
                  <div className="space-y-2">
                    <p className="text-red-300/75 text-xs">Something went wrong. You can try again, or run these commands manually in Terminal:</p>
                    <div className="rounded-lg px-3 py-2 font-mono text-[11px] space-y-0.5" style={{ background: 'rgba(0,0,0,0.35)', color: 'rgba(252,165,165,0.65)' }}>
                      <p>openclaw gateway stop</p>
                      <p>openclaw daemon uninstall</p>
                      <p>npm uninstall -g openclaw</p>
                    </div>
                    <button
                      onClick={() => { setUninstallStatus('idle'); setShowUninstallConfirm(true); }}
                      className="text-xs text-red-300/55 hover:text-red-300/80 transition-colors"
                    >
                      Try again
                    </button>
                  </div>
                )}
              </div>

            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full">
      <div
        className="overflow-hidden h-full flex flex-col"
        style={{
          background: `linear-gradient(140deg, rgba(5,8,17,0.96) 0%, rgba(10,8,12,0.98) 52%, rgba(14,6,6,0.96) 100%)`,
          WebkitBackdropFilter: 'blur(50px) saturate(160%)',
          backdropFilter: 'blur(50px) saturate(160%)',
        }}
      >
        {/* ── Header ── */}
        <div className="flex items-center gap-3 px-6 py-4" style={{ borderBottom: '1px solid rgba(234,70,71,0.15)' }}>
          <button
            onClick={onClose}
            className="text-white/30 hover:text-white/75 transition-colors p-0.5"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          {/* OpenClaw logo / wordmark */}
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <OpenClawIcon size={26} />
            <div className="min-w-0">
              <div className="text-white/92 text-[14px] font-semibold leading-none">
                OpenClaw Setup
              </div>
              <div className="text-white/38 text-[11px] mt-0.5">{STEPS[step]} · Step {step + 1} of {STEPS.length}</div>
            </div>
          </div>

          {/* Progress bar */}
          <div className="flex items-center gap-1">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className="h-1.5 rounded-full transition-all duration-300"
                style={{
                  width: i === step ? 20 : 6,
                  background: i < step ? BRAND.redDeep : i === step ? BRAND.red : 'rgba(255,255,255,0.12)',
                }}
              />
            ))}
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-6 py-5" style={{ background: bodyBg }}>

          {/* ── Step 0: Welcome ── */}
          {step === 0 && (
            <div className="max-w-4xl mx-auto min-h-full flex items-center">
              <div className="grid grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)] gap-6 w-full items-center">
                {/* Left: brand card */}
                <div
                  className="relative rounded-3xl p-7 flex flex-col gap-4"
                  style={{
                    background: 'linear-gradient(168deg, rgba(20,8,8,0.92) 0%, rgba(28,12,12,0.80) 100%)',
                    border: `1px solid ${BRAND.redBorder}`,
                    boxShadow: `inset 0 1px 0 rgba(234,70,71,0.18), 0 14px 38px rgba(0,0,0,0.48)`,
                  }}
                >
                  <div className="flex items-center gap-3">
                    <OpenClawIcon size={42} />
                    <div>
                      <p className="text-white text-xl font-bold leading-none">OpenClaw</p>
                      <p className="text-white/45 text-[11px] mt-1">Self-hosted AI agent gateway</p>
                    </div>
                  </div>
                  <p className="text-white/68 text-sm leading-relaxed">
                    Connect WhatsApp, Telegram, iMessage, and Discord to an AI agent that runs entirely on your Mac.
                  </p>
                  <p className="text-white/50 text-sm leading-relaxed">
                    Your hardware, your rules. MIT licensed. Zero data sent to third parties.
                  </p>
                  <div
                    className="rounded-xl px-4 py-3 mt-1"
                    style={{ border: '1px solid rgba(234,70,71,0.18)', background: 'rgba(234,70,71,0.07)' }}
                  >
                    <p className="text-white/80 text-xs font-medium mb-2">This wizard configures:</p>
                    <div className="text-white/58 text-xs space-y-1.5">
                      {[
                        'Node 22+ prerequisite check',
                        'Install OpenClaw CLI',
                        'Onboarding & LaunchAgent daemon',
                        'AI provider (Anthropic / OpenAI)',
                        'Messaging channels (optional)',
                        'Gateway launch & dashboard',
                      ].map((item) => (
                        <p key={item} className="flex items-center gap-2">
                          <span style={{ color: BRAND.red, flexShrink: 0 }}>✓</span> {item}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Right: feature cards */}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { icon: MessageCircle, title: 'Chat from Anywhere', desc: 'Message your AI agent via WhatsApp, iMessage, Telegram, Discord, Signal, and more.' },
                    { icon: Bot, title: 'AI Agent Runtime', desc: 'Powered by Anthropic Claude or OpenAI, running Pi in RPC mode with tool streaming.' },
                    { icon: Zap, title: 'Skills & Automation', desc: 'Install skills for web search, code execution, file ops, and custom workflows.' },
                    { icon: Wifi, title: 'Always-On Daemon', desc: 'Installs as a macOS LaunchAgent — starts your gateway automatically on login.' },
                    { icon: Terminal, title: 'Control Dashboard', desc: 'Browser UI at localhost:18789 — chat, sessions, config, and node management.' },
                    { icon: AlertTriangle, title: 'Fully Self-Hosted', desc: 'Everything runs on your machine. No third-party servers, no message proxying.' },
                  ].map((card) => {
                    const Icon = card.icon;
                    return (
                      <div
                        key={card.title}
                        className="rounded-2xl p-3.5 transition-all hover:border-opacity-60"
                        style={{
                          background: 'linear-gradient(160deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02))',
                          border: '1px solid rgba(234,70,71,0.16)',
                        }}
                      >
                        <div
                          className="w-7 h-7 rounded-lg flex items-center justify-center mb-2"
                          style={{ border: `1px solid ${BRAND.redBorder}`, background: BRAND.redDim }}
                        >
                          <Icon className="w-3.5 h-3.5" style={{ color: '#fca5a5' }} />
                        </div>
                        <p className="text-white/90 text-xs font-medium mb-1">{card.title}</p>
                        <p className="text-white/50 text-[11px] leading-relaxed">{card.desc}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ── Step 1: Safety & Permissions ── */}
          {step === 1 && (
            <div className="max-w-3xl mx-auto min-h-full flex items-center justify-center">
              <div className="w-full space-y-4">
                {/* Header */}
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ border: `1px solid rgba(251,191,36,0.40)`, background: 'rgba(251,191,36,0.12)' }}>
                    <ShieldAlert className="w-5 h-5 text-amber-300" />
                  </div>
                  <div>
                    <h3 className="text-white text-xl font-bold leading-none">Personal Assistant Setup</h3>
                    <p className="text-white/45 text-xs mt-1">Read carefully before continuing</p>
                  </div>
                </div>

                {/* What is this */}
                <div className="rounded-2xl p-4" style={{ border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)' }}>
                  <p className="text-white/75 text-sm leading-relaxed">
                    OpenClaw lets you chat with an <strong className="text-white/90">AI personal assistant</strong> through WhatsApp, Telegram, iMessage, and more — all running privately on your own Mac. No cloud, no data sharing, just you and your assistant.
                  </p>
                </div>

                {/* Main warning block */}
                <div className="rounded-2xl p-4 space-y-3" style={{ border: '1px solid rgba(251,191,36,0.30)', background: 'rgba(251,191,36,0.07)' }}>
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0" />
                    <p className="text-amber-200 text-sm font-semibold">Heads up — your assistant gets real capabilities</p>
                  </div>
                  <p className="text-amber-100/70 text-xs leading-relaxed">
                    Once set up, your AI assistant can do things on your behalf. Here's what you're enabling:
                  </p>
                  <div className="space-y-2">
                    {[
                      { icon: Terminal, label: 'Run programs on your Mac', desc: 'The assistant can run tasks and scripts on your computer — similar to what you can do yourself in Terminal.' },
                      { icon: Lock,     label: 'Read and write your files', desc: 'The assistant can access files in its own workspace folder. You can also grant it access to other folders if you choose.' },
                      { icon: MessageCircle, label: 'Send messages through your chat apps', desc: 'Once you connect WhatsApp, Telegram, or iMessage, the assistant can reply to your messages — and in some cases start new conversations.' },
                      { icon: Wifi,     label: 'Wake up and act on a schedule', desc: 'By default, the assistant checks in every 30 minutes to see if there\'s anything to do — even when you haven\'t messaged it. You can turn this off.' },
                    ].map(({ icon: Icon, label, desc }) => (
                      <div key={label} className="flex items-start gap-3 rounded-xl px-3 py-2.5" style={{ background: 'rgba(0,0,0,0.25)' }}>
                        <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 mt-0.5" style={{ border: '1px solid rgba(251,191,36,0.25)', background: 'rgba(251,191,36,0.10)' }}>
                          <Icon className="w-3.5 h-3.5 text-amber-300" />
                        </div>
                        <div>
                          <p className="text-amber-100/90 text-xs font-medium">{label}</p>
                          <p className="text-amber-100/55 text-[11px] mt-0.5 leading-relaxed">{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Apple / macOS specific note */}
                <div className="rounded-2xl p-4" style={{ border: `1px solid ${BRAND.redBorder}`, background: 'rgba(234,70,71,0.07)' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="w-4 h-4 shrink-0" style={{ color: '#fca5a5' }} />
                    <p className="text-red-200/90 text-sm font-semibold">Our recommendations before you start</p>
                  </div>
                  <div className="space-y-2 text-red-100/65 text-xs leading-relaxed">
                    <p className="flex items-start gap-2">
                      <span className="shrink-0 mt-0.5" style={{ color: BRAND.red }}>→</span>
                      <span><strong className="text-red-100/85">Only let your own number talk to the assistant.</strong> When you connect WhatsApp or Telegram, make sure only your number can send it commands — not just anyone with the number.</span>
                    </p>
                    <p className="flex items-start gap-2">
                      <span className="shrink-0 mt-0.5" style={{ color: BRAND.red }}>→</span>
                      <span><strong className="text-red-100/85">Use a separate phone number if you can.</strong> We recommend not using your main WhatsApp account — a spare SIM or a free number works great and keeps things tidy.</span>
                    </p>
                    <p className="flex items-start gap-2">
                      <span className="shrink-0 mt-0.5" style={{ color: BRAND.red }}>→</span>
                      <span><strong className="text-red-100/85">Turn off automatic wake-ups to start.</strong> The assistant can check in on a schedule without you asking. We suggest disabling this at first until you're familiar with how it works.</span>
                    </p>
                    <p className="flex items-start gap-2">
                      <span className="shrink-0 mt-0.5" style={{ color: BRAND.red }}>→</span>
                      <span><strong className="text-red-100/85">OpenClaw will start automatically when you log in.</strong> It installs a background helper so your assistant is always ready. You can remove this at any time from the OpenClaw dashboard or settings.</span>
                    </p>
                    <p className="flex items-start gap-2">
                      <span className="shrink-0 mt-0.5" style={{ color: BRAND.red }}>→</span>
                      <span><strong className="text-red-100/85">Your AI key is saved privately on your Mac.</strong> It's stored in a local settings file and never shared with anyone or sent over the internet.</span>
                    </p>
                  </div>
                </div>

                {/* Acknowledgment button */}
                {!safetyAcknowledged ? (
                  <button
                    onClick={() => setSafetyAcknowledged(true)}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm transition-all"
                    style={{ border: '1px solid rgba(251,191,36,0.40)', background: 'rgba(251,191,36,0.10)', color: '#fde68a' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(251,191,36,0.18)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(251,191,36,0.10)'; }}
                  >
                    <AlertTriangle className="w-4 h-4" />
                    I understand the risks — continue with setup
                  </button>
                ) : (
                  <div className="w-full flex items-center justify-center gap-2 py-3 rounded-xl" style={{ border: '1px solid rgba(110,231,183,0.35)', background: 'rgba(16,185,129,0.10)' }}>
                    <Check className="w-4 h-4 text-emerald-300" />
                    <span className="text-emerald-200 text-sm font-medium">Acknowledged — you can continue</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Step 2: Prerequisites ── */}
          {step === 2 && (
            <div className="max-w-3xl mx-auto min-h-full flex items-center justify-center">
              <div className="w-full space-y-4">
                <div className="flex items-center gap-3 mb-5">
                  <OpenClawIcon size={28} />
                  <div>
                    <h3 className="text-white text-xl font-semibold leading-none">Prerequisites</h3>
                    <p className="text-white/50 text-xs mt-1">Checking your system before installation.</p>
                  </div>
                </div>

                <div className="space-y-3">
                  {/* Node version */}
                  <div
                    className="rounded-2xl p-4"
                    style={{
                      border: `1px solid ${nodeStatus === 'done' ? 'rgba(110,231,183,0.40)' : nodeStatus === 'error' ? BRAND.redBorder : 'rgba(255,255,255,0.12)'}`,
                      background: nodeStatus === 'done'
                        ? 'linear-gradient(160deg,rgba(16,82,56,0.28),rgba(23,34,41,0.20))'
                        : nodeStatus === 'error'
                          ? 'linear-gradient(160deg,rgba(80,14,14,0.28),rgba(40,10,10,0.20))'
                          : 'rgba(255,255,255,0.05)',
                    }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <Terminal className="w-4 h-4 text-white/55" />
                        <p className="text-white/88 text-sm font-medium">Node.js 22 or newer</p>
                      </div>
                      <StatusBadge
                        status={nodeStatus}
                        label={nodeStatus === 'running' ? 'Checking…' : nodeStatus === 'done' ? nodeVersion : nodeStatus === 'error' ? (nodeVersion || 'Not found') : 'Required'}
                      />
                    </div>
                    <p className="text-white/48 text-xs">Required by the OpenClaw CLI.</p>
                    {nodeStatus === 'error' && (
                      <div className="mt-3 rounded-lg px-3 py-2.5 space-y-2" style={{ border: '1px solid rgba(251,191,36,0.25)', background: 'rgba(251,191,36,0.08)' }}>
                        <p className="text-amber-200/90 text-xs font-medium">
                          {nodeVersion && nodeVersion !== 'not found'
                            ? `Your Mac has ${nodeVersion} — OpenClaw needs version 22 or newer`
                            : 'Node.js not found — OpenClaw needs Node 22 or newer to run'
                          }
                        </p>
                        <p className="text-amber-100/60 text-[11px] leading-relaxed">
                          {nodeVersion && nodeVersion !== 'not found'
                            ? 'If you use nvm, run nvm install 22 && nvm use 22 in Terminal, then click Re-check above.'
                            : 'Install Node.js from the official website — it only takes a minute.'
                          }
                        </p>
                        <div className="flex gap-2 flex-wrap">
                          <button onClick={() => window.electron.openUrl('https://nodejs.org/en/download')} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] border border-amber-200/25 bg-amber-500/14 text-amber-200 hover:bg-amber-500/22 transition-colors">
                            Download Node 22 <ExternalLink className="w-3 h-3" />
                          </button>
                          <button onClick={() => window.electron.openUrl('https://github.com/nvm-sh/nvm#installing-and-updating')} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] border border-white/18 bg-white/[0.07] text-white/65 hover:bg-white/[0.12] transition-colors">
                            Using nvm? Guide here <ExternalLink className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* OpenClaw installed */}
                  <div
                    className="rounded-2xl p-4"
                    style={{
                      border: `1px solid ${openClawInstalled === true ? 'rgba(110,231,183,0.40)' : openClawInstalled === 'broken' ? 'rgba(251,191,36,0.35)' : 'rgba(255,255,255,0.12)'}`,
                      background: openClawInstalled === true ? 'linear-gradient(160deg,rgba(16,82,56,0.28),rgba(23,34,41,0.20))' : openClawInstalled === 'broken' ? 'rgba(251,191,36,0.07)' : 'rgba(255,255,255,0.05)',
                    }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <OpenClawIcon size={16} />
                        <p className="text-white/88 text-sm font-medium">OpenClaw</p>
                      </div>
                      {openClawInstalled === null
                        ? <StatusBadge status="running" label="Checking…" />
                        : openClawInstalled === true
                          ? <StatusBadge status="done" label="Installed & working" />
                          : openClawInstalled === 'broken'
                            ? <StatusBadge status="error" label="Found but not working" />
                            : <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] border border-white/18 bg-white/[0.06] text-white/52">Not installed — next step installs it</span>
                      }
                    </div>
                    {openClawInstalled === 'broken' && (
                      <p className="text-amber-200/75 text-xs mt-1 leading-relaxed">
                        OpenClaw is on your Mac but can't start — likely installed with the wrong Node.js version. The next step will reinstall it properly.
                      </p>
                    )}
                    {openClawInstalled !== 'broken' && (
                      <p className="text-white/48 text-xs">The OpenClaw app and command-line tool.</p>
                    )}
                  </div>
                </div>

                <button
                  onClick={checkPrerequisites}
                  disabled={nodeStatus === 'running' || openClawInstalled === null}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/18 bg-white/[0.07] text-white/65 text-xs hover:bg-white/[0.12] transition-colors disabled:opacity-40"
                >
                  <Loader2 className={`w-3 h-3 ${nodeStatus === 'running' ? 'animate-spin' : ''}`} />
                  Re-check
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Install ── */}
          {step === 3 && (
            <div className="max-w-3xl mx-auto min-h-full flex items-center justify-center">
              <div className="w-full space-y-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <OpenClawIcon size={28} />
                    <div>
                      <h3 className="text-white text-xl font-semibold leading-none">Install OpenClaw</h3>
                      <p className="text-white/50 text-xs mt-1">
                        {openClawInstalled === true && installStatus === 'pending'
                          ? 'OpenClaw is installed and working on your Mac.'
                          : openClawInstalled === 'broken'
                            ? 'A previous install was found but needs to be fixed.'
                            : 'Downloads and sets up the OpenClaw app on your Mac.'}
                      </p>
                    </div>
                  </div>
                  <StatusBadge
                    status={
                      openClawInstalled === true && installStatus === 'pending' ? 'done'
                      : openClawInstalled === 'broken' && installStatus === 'pending' ? 'error'
                      : installStatus
                    }
                    label={
                      openClawInstalled === true && installStatus === 'pending' ? 'Working'
                      : openClawInstalled === 'broken' && installStatus === 'pending' ? 'Needs reinstall'
                      : undefined
                    }
                  />
                </div>

                {/* Broken install warning — shown prominently, auto-exposes install UI */}
                {openClawInstalled === 'broken' && installStatus === 'pending' && (
                  <div className="rounded-2xl p-4 flex items-start gap-3" style={{ border: '1px solid rgba(251,191,36,0.35)', background: 'rgba(251,191,36,0.08)' }}>
                    <AlertTriangle className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-amber-100 text-sm font-medium mb-1">OpenClaw was found but isn't working</p>
                      <p className="text-amber-100/65 text-xs leading-relaxed">
                        It looks like a previous install didn't finish properly — probably because of the Node.js version issue. Click <strong>Reinstall</strong> below to fix it cleanly.
                      </p>
                    </div>
                  </div>
                )}

                {/* Already installed and working — show green card but keep reinstall accessible */}
                {openClawInstalled === true && installStatus === 'pending' ? (
                  <div className="space-y-3">
                    <div className="rounded-2xl p-4 flex items-start gap-3" style={{ border: '1px solid rgba(110,231,183,0.30)', background: 'rgba(16,185,129,0.08)' }}>
                      <CheckCircle className="w-5 h-5 text-emerald-300 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-emerald-100 text-sm font-medium mb-1">OpenClaw is installed and working</p>
                        <p className="text-emerald-100/65 text-xs leading-relaxed">OpenClaw was detected and is ready to use. Click Continue to move to the next step.</p>
                      </div>
                    </div>
                    <button
                      onClick={runInstall}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/18 bg-white/[0.06] text-white/45 text-xs hover:text-white/65 hover:bg-white/10 transition-colors"
                    >
                      <Terminal className="w-3 h-3" /> Reinstall anyway
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="rounded-xl px-4 py-3" style={{ background: '#0a0c10', border: '1px solid rgba(234,70,71,0.15)' }}>
                      <p className="text-white/40 text-[10px] font-mono mb-0.5">install command</p>
                      <p className="font-mono text-[11px]" style={{ color: '#fca5a5' }}>curl -fsSL https://openclaw.ai/install.sh | bash</p>
                    </div>

                    {installStatus === 'pending' && (
                      <div className="rounded-2xl p-4 text-white/60 text-xs leading-relaxed" style={{ border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)' }}>
                        {openClawInstalled === 'broken'
                          ? 'This will remove the broken install and set up a fresh copy. Usually takes about a minute.'
                          : 'Downloads and installs OpenClaw on your Mac. Requires Node 22+. Usually takes about a minute.'}
                      </div>
                    )}

                    {installStatus !== 'pending' && <TerminalPanel lines={installLines} panelRef={installOutputRef} />}

                    {/* Node version mismatch — friendly plain-English card */}
                    {installNodeError && (
                      <div className="rounded-2xl p-4 space-y-3" style={{ border: '1px solid rgba(251,191,36,0.35)', background: 'rgba(251,191,36,0.09)' }}>
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0" />
                          <p className="text-amber-200 text-sm font-semibold">Your Mac needs a newer version of Node.js</p>
                        </div>
                        <p className="text-amber-100/75 text-xs leading-relaxed">
                          OpenClaw requires <strong>Node.js version 22</strong> or newer to run. Your Mac has an older version active right now. Don't worry — this is easy to fix!
                        </p>
                        <div className="space-y-2 text-amber-100/65 text-xs leading-relaxed">
                          <p className="flex items-start gap-2">
                            <span className="shrink-0 mt-0.5 font-bold text-amber-300">1.</span>
                            <span><strong className="text-amber-100/90">Using nvm?</strong> Open Terminal and run: <code className="font-mono bg-black/30 px-1 rounded">nvm install 22 &amp;&amp; nvm use 22</code> — then come back and click Retry below.</span>
                          </p>
                          <p className="flex items-start gap-2">
                            <span className="shrink-0 mt-0.5 font-bold text-amber-300">2.</span>
                            <span><strong className="text-amber-100/90">Don't use nvm?</strong> Download Node 22 from the official website — it's a simple installer.</span>
                          </p>
                        </div>
                        <button
                          onClick={() => window.electron.openUrl('https://nodejs.org/en/download')}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs text-amber-200 transition-colors hover:bg-amber-500/20"
                          style={{ borderColor: 'rgba(251,191,36,0.35)', background: 'rgba(251,191,36,0.12)' }}
                        >
                          Download Node 22 <ExternalLink className="w-3 h-3" />
                        </button>
                      </div>
                    )}

                    {installStatus === 'pending' && (
                      <button
                        onClick={runInstall}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium text-white transition-colors"
                        style={{ border: `1px solid ${BRAND.redBorder}`, background: BRAND.redDim }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(234,70,71,0.34)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = BRAND.redDim; }}
                      >
                        <Terminal className="w-4 h-4" />
                        {openClawInstalled === 'broken' ? 'Reinstall OpenClaw' : 'Install OpenClaw'}
                      </button>
                    )}
                    {installStatus === 'running' && (
                      <div className="flex items-center gap-2 text-white/55 text-xs">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: BRAND.red }} />
                        Installing… usually about a minute
                      </div>
                    )}
                    {installStatus === 'error' && (
                      <div className="rounded-xl px-4 py-3" style={{ border: `1px solid ${BRAND.redBorder}`, background: BRAND.redDim }}>
                        <p className="text-red-200/90 text-xs font-medium mb-1">Installation ran into a problem</p>
                        <p className="text-red-200/65 text-xs mb-2">{installNodeError ? 'Fix the Node.js version issue above, then retry.' : 'Something went wrong. Check the output above for clues, or try again.'}</p>
                        <button onClick={runInstall} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border text-white/80 hover:bg-white/10 transition-colors" style={{ borderColor: BRAND.redBorder, background: 'rgba(234,70,71,0.12)' }}>
                          Retry
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── Step 4: Onboard & Daemon ── */}
          {step === 4 && (
            <div className="max-w-3xl mx-auto min-h-full flex items-center justify-center">
              <div className="w-full space-y-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <OpenClawIcon size={28} />
                    <div>
                      <h3 className="text-white text-xl font-semibold leading-none">Onboard &amp; Install Daemon</h3>
                      <p className="text-white/50 text-xs mt-1">Sets up workspace, config, and installs a macOS LaunchAgent.</p>
                    </div>
                  </div>
                  <StatusBadge status={onboardStatus} />
                </div>

                {onboardStatus === 'pending' && !onboardWarningDismissed && (
                  <div className="rounded-2xl p-4" style={{ border: '1px solid rgba(251,191,36,0.25)', background: 'rgba(251,191,36,0.07)' }}>
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-amber-100/90 text-sm font-medium mb-2">What this does to your Mac</p>
                        <ul className="text-amber-100/65 text-xs space-y-1.5 list-disc pl-4">
                          <li>Creates an <strong>OpenClaw folder</strong> on your Mac to store settings and your workspace</li>
                          <li>Sets up a <strong>background helper</strong> so OpenClaw starts automatically when you log in</li>
                          <li>Downloads the starter tools and abilities your AI assistant will use</li>
                          <li>Runs quietly in the background with sensible default settings — no questions asked</li>
                        </ul>
                        <p className="text-amber-100/50 text-[11px] mt-2">Changed your mind? You can undo this from the OpenClaw settings or dashboard at any time.</p>
                        <button
                          onClick={() => setOnboardWarningDismissed(true)}
                          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs text-amber-200 transition-colors hover:bg-amber-500/18"
                          style={{ borderColor: 'rgba(251,191,36,0.25)', background: 'rgba(251,191,36,0.09)' }}
                        >
                          I understand, continue
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {(onboardWarningDismissed || onboardStatus !== 'pending') && (
                  <>
                    {onboardStatus !== 'pending' && <TerminalPanel lines={onboardLines} panelRef={onboardOutputRef} />}

                    {/* Node version mismatch during onboard */}
                    {onboardNodeError && (
                      <div className="rounded-2xl p-4 space-y-3" style={{ border: '1px solid rgba(251,191,36,0.35)', background: 'rgba(251,191,36,0.09)' }}>
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0" />
                          <p className="text-amber-200 text-sm font-semibold">Your Mac needs a newer version of Node.js</p>
                        </div>
                        <p className="text-amber-100/75 text-xs leading-relaxed">
                          OpenClaw needs <strong>Node.js version 22</strong> or newer. Your Mac currently has an older version active. Fix this in Terminal, then retry below.
                        </p>
                        <p className="text-amber-100/65 text-xs font-mono bg-black/30 rounded-lg px-3 py-2">nvm install 22 &amp;&amp; nvm use 22</p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => window.electron.openUrl('https://nodejs.org/en/download')}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs text-amber-200 transition-colors hover:bg-amber-500/20"
                            style={{ borderColor: 'rgba(251,191,36,0.35)', background: 'rgba(251,191,36,0.12)' }}
                          >
                            Download Node 22 <ExternalLink className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    )}

                    {onboardStatus === 'pending' && onboardWarningDismissed && (
                      <div className="space-y-3">
                        {/* Heads up about browser opening */}
                        <div className="flex items-start gap-2 rounded-xl px-3 py-2.5" style={{ border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)' }}>
                          <Info className="w-3.5 h-3.5 text-white/45 shrink-0 mt-0.5" />
                          <p className="text-white/50 text-xs leading-relaxed">
                            <strong className="text-white/70">Heads up:</strong> Once set up, OpenClaw starts automatically and may open your browser to the dashboard. If that happens, just close the browser tab and come back here to finish.
                          </p>
                        </div>
                        <button
                          onClick={runOnboard}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium text-white transition-colors"
                          style={{ border: `1px solid ${BRAND.redBorder}`, background: BRAND.redDim }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(234,70,71,0.34)'; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = BRAND.redDim; }}
                        >
                          <Zap className="w-4 h-4" /> Set Up OpenClaw
                        </button>
                      </div>
                    )}
                    {onboardStatus === 'running' && (
                      <div className="flex items-center gap-2 text-white/55 text-xs">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: BRAND.red }} />
                        Setting up your assistant — please wait
                      </div>
                    )}
                    {onboardStatus === 'done' && (
                      <div className="space-y-2">
                        <div className="rounded-xl px-4 py-3 flex items-center gap-2" style={{ border: '1px solid rgba(110,231,183,0.30)', background: 'rgba(16,185,129,0.08)' }}>
                          <CheckCircle className="w-4 h-4 text-emerald-300 shrink-0" />
                          <p className="text-emerald-100/90 text-sm">All set! Your assistant is configured and ready.</p>
                        </div>
                        <div className="flex items-start gap-2 rounded-xl px-3 py-2" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
                          <Info className="w-3 h-3 text-white/35 shrink-0 mt-0.5" />
                          <p className="text-white/40 text-xs">If your browser opened the OpenClaw dashboard, you can close it for now — click Continue to finish setup here.</p>
                        </div>
                      </div>
                    )}
                    {onboardStatus === 'error' && (
                      <div className="rounded-xl px-4 py-3" style={{ border: `1px solid ${BRAND.redBorder}`, background: BRAND.redDim }}>
                        <p className="text-red-200/90 text-xs font-medium mb-1">Something went wrong during setup</p>
                        <p className="text-red-200/65 text-xs mb-2">{onboardNodeError ? 'Fix the Node.js version issue above, then retry.' : 'You can try again below, or skip this step and continue — you can always run setup later from the dashboard.'}</p>
                        <button onClick={runOnboard} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-white/80 transition-colors hover:bg-white/10" style={{ border: `1px solid ${BRAND.redBorder}`, background: 'rgba(234,70,71,0.12)' }}>
                          Try again
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── Step 5: AI Provider ── */}
          {step === 5 && (
            <div className="max-w-2xl mx-auto min-h-full flex items-center justify-center">
              <div className="w-full space-y-5">
                <div className="flex items-center gap-3">
                  <OpenClawIcon size={28} />
                  <div>
                    <h3 className="text-white text-xl font-semibold leading-none">Connect Your AI</h3>
                    <p className="text-white/50 text-xs mt-1">Paste your API key and we'll save it for you — no config files needed.</p>
                  </div>
                </div>

                {/* Provider toggle */}
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { id: 'anthropic' as const, name: 'Anthropic Claude', badge: 'Recommended', desc: 'Powers Claude Sonnet & Opus. Best quality.', docsUrl: 'https://console.anthropic.com/settings/keys', prefix: 'sk-ant-' },
                    { id: 'openai' as const, name: 'OpenAI', badge: null, desc: 'GPT-4o and other OpenAI models.', docsUrl: 'https://platform.openai.com/api-keys', prefix: 'sk-' },
                  ]).map((p) => (
                    <button
                      key={p.id}
                      onClick={() => { setSelectedProvider(p.id); setApiKey(''); setApiKeySaveStatus('idle'); setSelectedModel(MODELS[p.id][0].id); }}
                      className="rounded-2xl p-4 text-left transition-all"
                      style={{
                        border: selectedProvider === p.id ? `1px solid ${BRAND.redBorder}` : '1px solid rgba(255,255,255,0.10)',
                        background: selectedProvider === p.id ? BRAND.redDim : 'rgba(255,255,255,0.04)',
                      }}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-white/90 text-sm font-semibold">{p.name}</p>
                        {p.badge && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px]" style={{ border: `1px solid ${BRAND.redBorder}`, background: 'rgba(234,70,71,0.18)', color: '#fca5a5' }}>
                            {p.badge}
                          </span>
                        )}
                      </div>
                      <p className="text-white/48 text-xs">{p.desc}</p>
                    </button>
                  ))}
                </div>

                {/* Already configured banner */}
                {existingApiProvider && (
                  <div className="flex items-center gap-2 rounded-xl px-4 py-3" style={{ border: '1px solid rgba(110,231,183,0.35)', background: 'rgba(16,185,129,0.10)' }}>
                    <CheckCircle className="w-4 h-4 text-emerald-300 shrink-0" />
                    <p className="text-emerald-100/90 text-sm">
                      {existingApiProvider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key already configured — you're good to go! You can update it below if needed.
                    </p>
                  </div>
                )}

                {/* API key input */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-white/80 text-sm font-medium">
                      {existingApiProvider ? 'Update your' : 'Paste your'} {selectedProvider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key
                    </p>
                    <button
                      onClick={() => window.electron.openUrl(selectedProvider === 'anthropic' ? 'https://console.anthropic.com/settings/keys' : 'https://platform.openai.com/api-keys')}
                      className="inline-flex items-center gap-1 text-xs transition-colors"
                      style={{ color: 'rgba(252,165,165,0.65)' }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#fca5a5'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(252,165,165,0.65)'; }}
                    >
                      Get your key <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="relative">
                    <input
                      type={apiKeyVisible ? 'text' : 'password'}
                      value={apiKey}
                      onChange={(e) => { setApiKey(e.target.value); setApiKeySaveStatus('idle'); setApiKeyError(''); }}
                      placeholder={selectedProvider === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
                      autoComplete="off"
                      spellCheck={false}
                      className="w-full rounded-xl px-4 py-3 text-sm font-mono pr-11 outline-none"
                      style={{
                        background: '#0a0c10',
                        border: `1px solid ${apiKeySaveStatus === 'error' ? BRAND.redBorder : apiKeySaveStatus === 'saved' ? 'rgba(110,231,183,0.40)' : 'rgba(255,255,255,0.14)'}`,
                        color: '#fca5a5',
                      }}
                    />
                    <button
                      onClick={() => setApiKeyVisible((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/35 hover:text-white/65 transition-colors"
                    >
                      {apiKeyVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  {/* Key format hint */}
                  {apiKey.length > 4 && selectedProvider === 'anthropic' && !apiKey.startsWith('sk-ant-') && (
                    <p className="text-amber-300/70 text-xs flex items-center gap-1.5">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      Anthropic keys start with <code className="font-mono">sk-ant-</code> — double-check you copied the right one
                    </p>
                  )}

                  {/* Model selector */}
                  <div className="space-y-2">
                    <p className="text-white/60 text-xs font-medium">Model <span className="text-white/30 font-normal">— first option is OpenClaw&apos;s recommendation</span></p>
                    <div className="grid grid-cols-1 gap-1.5">
                      {MODELS[selectedProvider].map((m) => (
                        <button
                          key={m.id}
                          onClick={() => setSelectedModel(m.id)}
                          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all"
                          style={{
                            border: selectedModel === m.id ? `1px solid ${BRAND.redBorder}` : '1px solid rgba(255,255,255,0.09)',
                            background: selectedModel === m.id ? BRAND.redDim : 'rgba(255,255,255,0.03)',
                          }}
                        >
                          <div className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center ${selectedModel === m.id ? 'border-red-400' : 'border-white/25'}`}>
                            {selectedModel === m.id && <div className="w-1.5 h-1.5 rounded-full bg-red-400" />}
                          </div>
                          <span className="text-white/85 text-xs flex-1">{m.label}</span>
                          {m.recommended && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(234,70,71,0.22)', color: '#fca5a5', border: '1px solid rgba(234,70,71,0.35)' }}>Recommended</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Save button */}
                  {apiKey.trim().length > 10 && apiKeySaveStatus !== 'saved' && (
                    <button
                      onClick={saveApiKey}
                      disabled={apiKeySaveStatus === 'saving'}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm transition-all disabled:opacity-50"
                      style={{ border: `1px solid ${BRAND.redBorder}`, background: BRAND.redDim, color: 'white' }}
                      onMouseEnter={(e) => { if (!e.currentTarget.disabled) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(234,70,71,0.34)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = BRAND.redDim; }}
                    >
                      {apiKeySaveStatus === 'saving'
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                        : <><Check className="w-4 h-4" /> Save API Key to OpenClaw</>
                      }
                    </button>
                  )}

                  {/* Success */}
                  {apiKeySaveStatus === 'saved' && (
                    <div className="flex items-center gap-2 rounded-xl px-4 py-3" style={{ border: '1px solid rgba(110,231,183,0.35)', background: 'rgba(16,185,129,0.10)' }}>
                      <CheckCircle className="w-4 h-4 text-emerald-300 shrink-0" />
                      <p className="text-emerald-100/90 text-sm">API key saved! Your assistant is connected to {selectedProvider === 'anthropic' ? 'Anthropic Claude' : 'OpenAI'}.</p>
                    </div>
                  )}

                  {/* Error */}
                  {apiKeySaveStatus === 'error' && (
                    <p className="text-red-300/75 text-xs">{apiKeyError}</p>
                  )}
                </div>

                {/* Skip note */}
                <div className="flex items-start gap-2 rounded-xl px-3 py-2.5" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
                  <Info className="w-3.5 h-3.5 text-white/35 shrink-0 mt-0.5" />
                  <p className="text-white/40 text-xs leading-relaxed">
                    You can skip this for now and add your key later from the OpenClaw dashboard → Settings.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 6: Your Bot ── */}
          {step === 6 && (
            <div className="max-w-2xl mx-auto min-h-full flex items-center justify-center">
              <div className="w-full space-y-5">
                <div className="flex items-center gap-3">
                  <OpenClawIcon size={28} />
                  <div>
                    <h3 className="text-white text-xl font-semibold leading-none">Your Bot's Personality</h3>
                    <p className="text-white/50 text-xs mt-1">Give your assistant a name and describe how it should act. Skip if you want the defaults.</p>
                  </div>
                </div>

                {/* Bot name */}
                <div className="space-y-2">
                  <label className="text-white/75 text-sm font-medium">What should your assistant be called?</label>
                  <input
                    type="text"
                    value={botName}
                    onChange={(e) => { setBotName(e.target.value); setIdentitySavedStatus('idle'); }}
                    placeholder="e.g. Alex, Aria, Friday…"
                    className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                    style={{ background: '#0a0c10', border: '1px solid rgba(255,255,255,0.14)', color: 'white' }}
                  />
                </div>

                {/* Personality */}
                <div className="space-y-2">
                  <label className="text-white/75 text-sm font-medium">How should it respond? <span className="text-white/38 font-normal">(optional)</span></label>
                  <textarea
                    value={botPersonality}
                    onChange={(e) => { setBotPersonality(e.target.value); setIdentitySavedStatus('idle'); }}
                    placeholder="e.g. Be concise and friendly. When I ask about my schedule, check my calendar first. Always respond in English."
                    rows={3}
                    className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none"
                    style={{ background: '#0a0c10', border: '1px solid rgba(255,255,255,0.14)', color: 'white' }}
                  />
                  <p className="text-white/35 text-[11px]">Think of this like instructions you'd give a new assistant on their first day.</p>
                </div>

                {/* Memory instructions */}
                <div className="space-y-2">
                  <label className="text-white/75 text-sm font-medium">What should it always remember? <span className="text-white/38 font-normal">(optional)</span></label>
                  <textarea
                    value={botMemory}
                    onChange={(e) => { setBotMemory(e.target.value); setIdentitySavedStatus('idle'); }}
                    placeholder="e.g. My name is Sam. I live in London. I prefer metric units. My work email is sam@example.com."
                    rows={3}
                    className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none"
                    style={{ background: '#0a0c10', border: '1px solid rgba(255,255,255,0.14)', color: 'white' }}
                  />
                  <p className="text-white/35 text-[11px]">This context is always included when your assistant thinks about your requests.</p>
                </div>

                {/* Save */}
                {(botName || botPersonality || botMemory) && identitySavedStatus !== 'saved' && (
                  <button
                    onClick={saveBotIdentity}
                    disabled={identitySavedStatus === 'saving'}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium text-white transition-colors disabled:opacity-50"
                    style={{ border: `1px solid ${BRAND.redBorder}`, background: BRAND.redDim }}
                    onMouseEnter={(e) => { if (!e.currentTarget.disabled) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(234,70,71,0.34)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = BRAND.redDim; }}
                  >
                    {identitySavedStatus === 'saving' ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <><Check className="w-4 h-4" /> Save Bot Settings</>}
                  </button>
                )}
                {identitySavedStatus === 'saved' && (
                  <div className="flex items-center gap-2 rounded-xl px-4 py-3" style={{ border: '1px solid rgba(110,231,183,0.35)', background: 'rgba(16,185,129,0.10)' }}>
                    <CheckCircle className="w-4 h-4 text-emerald-300 shrink-0" />
                    <p className="text-emerald-100/90 text-sm">Bot settings saved! You can always change these from the dashboard.</p>
                  </div>
                )}
                {identitySavedStatus === 'error' && (
                  <p className="text-red-300/75 text-xs">Couldn't save — make sure the Onboard step completed first.</p>
                )}
              </div>
            </div>
          )}

          {/* ── Step 7: Channels ── */}
          {step === 7 && (
            <div className="max-w-2xl mx-auto min-h-full flex items-start justify-center pt-4">
              <div className="w-full space-y-3">
                <div className="flex items-center gap-3">
                  <OpenClawIcon size={28} />
                  <div>
                    <h3 className="text-white text-xl font-semibold leading-none">
                      Connect a Messaging App <span className="text-white/38 text-sm font-normal ml-1">(optional)</span>
                    </h3>
                    <p className="text-white/50 text-xs mt-1">Pick one to set up now, or skip and do it from your dashboard later.</p>
                  </div>
                </div>

                {/* Security guidance */}
                <div className="rounded-2xl p-4 flex items-start gap-3" style={{ border: '1px solid rgba(251,191,36,0.22)', background: 'rgba(251,191,36,0.06)' }}>
                  <Shield className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-amber-200/85 text-xs font-medium mb-1">Use YOUR phone number for each channel</p>
                    <p className="text-amber-100/60 text-[11px] leading-relaxed">
                      When you connect WhatsApp or Telegram, your assistant only listens to messages from your number — everyone else's messages are ignored. This keeps your bot private. We'll ask for your number so we can lock it to only respond to you.
                    </p>
                  </div>
                </div>

                {/* Telegram — inline guided setup */}
                <div
                  className="rounded-2xl overflow-hidden transition-all"
                  style={{ border: `1px solid ${expandedChannel === 'telegram' ? BRAND.redBorder : 'rgba(234,70,71,0.16)'}`, background: expandedChannel === 'telegram' ? 'rgba(234,70,71,0.06)' : 'rgba(255,255,255,0.04)' }}
                >
                  <button
                    className="w-full flex items-center justify-between p-4 text-left"
                    onClick={() => setExpandedChannel(expandedChannel === 'telegram' ? null : 'telegram')}
                  >
                    <div className="flex items-center gap-2">
                      <p className="text-white/88 text-sm font-medium">Telegram</p>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px]" style={{ border: '1px solid rgba(110,231,183,0.35)', background: 'rgba(16,185,129,0.18)', color: '#6ee7b7' }}>Easiest to set up</span>
                      {telegramSaveStatus === 'saved' && <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />}
                    </div>
                    <ArrowRight className="w-4 h-4 text-white/35 transition-transform" style={{ transform: expandedChannel === 'telegram' ? 'rotate(90deg)' : 'none' }} />
                  </button>
                  {expandedChannel === 'telegram' && (
                    <div className="px-4 pb-4 space-y-4">
                      {/* Step-by-step guide */}
                      <div className="space-y-3">
                        {[
                          { n: 1, text: 'Open Telegram on your phone and search for ', link: { label: '@BotFather', url: 'https://t.me/BotFather' }, rest: ' — tap Start.' },
                          { n: 2, text: 'Type ', code: '/newbot', rest: ' and follow the prompts to create a bot. Pick any name and username.' },
                          { n: 3, text: 'BotFather will send a token like ', code: '1234567890:ABCdef...', rest: ' — copy it and paste below.' },
                        ].map(({ n, text, link, code, rest }) => (
                          <div key={n} className="flex items-start gap-3">
                            <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5" style={{ background: BRAND.redDim, border: `1px solid ${BRAND.redBorder}`, color: '#fca5a5' }}>{n}</span>
                            <p className="text-white/65 text-xs leading-relaxed">
                              {text}
                              {link && <button onClick={() => window.electron.openUrl(link.url)} className="underline text-white/80">{link.label}</button>}
                              {code && <code className="font-mono bg-black/30 px-1 rounded text-white/80">{code}</code>}
                              {rest}
                            </p>
                          </div>
                        ))}
                      </div>
                      {/* Bot token input */}
                      <div className="space-y-2">
                        <p className="text-white/70 text-xs font-medium">Step 4 — Paste your bot token:</p>
                        <input
                          type="text"
                          value={telegramToken}
                          onChange={(e) => { setTelegramToken(e.target.value); setTelegramSaveStatus('idle'); }}
                          placeholder="1234567890:ABCdefGhIJKlmNOPqRstUVWxyz"
                          className="w-full rounded-xl px-4 py-2.5 text-sm font-mono outline-none"
                          style={{ background: '#0a0c10', border: `1px solid ${telegramSaveStatus === 'saved' ? 'rgba(110,231,183,0.40)' : 'rgba(255,255,255,0.14)'}`, color: '#fca5a5' }}
                        />
                      </div>
                      {/* Telegram user ID for allowFrom */}
                      <div className="space-y-2">
                        <p className="text-white/70 text-xs font-medium">Step 5 — Your Telegram user ID <span className="text-white/35 font-normal">(optional)</span></p>
                        <p className="text-white/40 text-[11px] leading-relaxed">Restrict the bot to only respond to your account. Must be a numeric Telegram user ID — message <strong className="text-white/55">@userinfobot</strong> on Telegram to find yours. Leave blank to use pairing mode (anyone can pair via /start).</p>
                        <input
                          type="text"
                          value={telegramPhone}
                          onChange={(e) => { setTelegramPhone(e.target.value); setTelegramAllowSaved(false); }}
                          placeholder="e.g. 123456789"
                          className="w-full rounded-xl px-4 py-2.5 text-sm outline-none"
                          style={{ background: '#0a0c10', border: '1px solid rgba(255,255,255,0.14)', color: 'white' }}
                        />
                      </div>
                      {telegramToken.trim().length > 10 && telegramSaveStatus !== 'saved' && (
                        <button
                          onClick={async () => { await saveTelegramToken(); if (telegramPhone.trim()) await saveTelegramAllowList(); }}
                          disabled={telegramSaveStatus === 'saving'}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium text-white transition-colors disabled:opacity-50"
                          style={{ border: `1px solid ${BRAND.redBorder}`, background: BRAND.redDim }}
                          onMouseEnter={(e) => { if (!e.currentTarget.disabled) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(234,70,71,0.34)'; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = BRAND.redDim; }}
                        >
                          {telegramSaveStatus === 'saving' ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <><Check className="w-4 h-4" /> Connect Telegram</>}
                        </button>
                      )}
                      {telegramSaveStatus === 'saved' && (
                        <div className="rounded-xl px-3 py-2.5 space-y-2" style={{ border: '1px solid rgba(110,231,183,0.35)', background: 'rgba(16,185,129,0.10)' }}>
                          <div className="flex items-center gap-2">
                            <CheckCircle className="w-4 h-4 text-emerald-300 shrink-0" />
                            <p className="text-emerald-100/90 text-xs font-medium">
                              Telegram connected{telegramBotUsername ? ` — @${telegramBotUsername}` : ''}!
                            </p>
                          </div>
                          {telegramBotUsername ? (
                            <div className="space-y-1 pl-6">
                              <p className="text-emerald-100/70 text-[11px] font-medium">To start chatting with your bot:</p>
                              <p className="text-emerald-100/60 text-[11px] leading-relaxed">
                                1. Open Telegram → search for <strong className="text-emerald-100/85">@{telegramBotUsername}</strong><br />
                                2. Tap the bot → press <strong className="text-emerald-100/85">Start</strong> (or send <code className="font-mono bg-black/25 px-1 rounded">/start</code>)<br />
                                3. Make sure the gateway is running, then send any message
                              </p>
                            </div>
                          ) : (
                            <p className="text-emerald-100/65 text-[11px] pl-6 leading-relaxed">
                              Start the gateway, then open Telegram and search for your bot to begin chatting.
                            </p>
                          )}
                        </div>
                      )}
                      {telegramSaveStatus === 'error' && (
                        <p className="text-red-300/75 text-xs">Couldn't save — make sure the Onboard step completed.</p>
                      )}
                    </div>
                  )}
                </div>

                {/* WhatsApp — inline guided setup */}
                <div
                  className="rounded-2xl overflow-hidden transition-all"
                  style={{ border: `1px solid ${expandedChannel === 'whatsapp' ? BRAND.redBorder : 'rgba(234,70,71,0.16)'}`, background: expandedChannel === 'whatsapp' ? 'rgba(234,70,71,0.06)' : 'rgba(255,255,255,0.04)' }}
                >
                  <button className="w-full flex items-center justify-between p-4 text-left" onClick={() => setExpandedChannel(expandedChannel === 'whatsapp' ? null : 'whatsapp')}>
                    <div className="flex items-center gap-2">
                      <p className="text-white/88 text-sm font-medium">WhatsApp</p>
                      {whatsappAllowSaved && <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />}
                    </div>
                    <ArrowRight className="w-4 h-4 text-white/35" style={{ transform: expandedChannel === 'whatsapp' ? 'rotate(90deg)' : 'none' }} />
                  </button>
                  {expandedChannel === 'whatsapp' && (
                    <div className="px-4 pb-4 space-y-4">
                      {/* Install check note */}
                      <div className="rounded-xl px-3 py-2.5 flex items-start gap-2" style={{ border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)' }}>
                        <Info className="w-3.5 h-3.5 text-white/40 shrink-0 mt-0.5" />
                        <p className="text-white/55 text-[11px] leading-relaxed">
                          <strong className="text-white/75">Requirements:</strong> WhatsApp must be installed on your phone and your number must be active. WhatsApp Desktop on Mac is not required — the bot connects via WhatsApp Web protocol.
                        </p>
                      </div>
                      <div className="space-y-3">
                        {[
                          { n: 1, text: 'Enter your WhatsApp phone number below (with country code). This locks the bot to only respond to YOU.' },
                          { n: 2, text: 'After saving, start the gateway and go to the dashboard → Channels → WhatsApp to scan the QR code with your phone.' },
                          { n: 3, text: 'Open WhatsApp on your phone → Menu → Linked Devices → Link a device, then scan.' },
                        ].map(({ n, text }) => (
                          <div key={n} className="flex items-start gap-3">
                            <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5" style={{ background: BRAND.redDim, border: `1px solid ${BRAND.redBorder}`, color: '#fca5a5' }}>{n}</span>
                            <p className="text-white/65 text-xs leading-relaxed">{text}</p>
                          </div>
                        ))}
                      </div>
                      <div className="space-y-2">
                        <p className="text-white/70 text-xs font-medium">Your WhatsApp number (with country code):</p>
                        <input
                          type="tel"
                          value={whatsappPhone}
                          onChange={(e) => { setWhatsappPhone(e.target.value); setWhatsappAllowSaved(false); }}
                          placeholder="+1 555 000 1234"
                          className="w-full rounded-xl px-4 py-2.5 text-sm outline-none"
                          style={{ background: '#0a0c10', border: `1px solid ${whatsappAllowSaved ? 'rgba(110,231,183,0.40)' : 'rgba(255,255,255,0.14)'}`, color: 'white' }}
                        />
                        <p className="text-white/35 text-[11px]">Only messages from this number will control your assistant.</p>
                      </div>
                      {whatsappPhone.trim().length > 5 && !whatsappAllowSaved && (
                        <button
                          onClick={saveWhatsappAllowList}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium text-white transition-colors"
                          style={{ border: `1px solid ${BRAND.redBorder}`, background: BRAND.redDim }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(234,70,71,0.34)'; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = BRAND.redDim; }}
                        >
                          <Check className="w-4 h-4" /> Save My Number
                        </button>
                      )}
                      {whatsappAllowSaved && (
                        <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ border: '1px solid rgba(110,231,183,0.35)', background: 'rgba(16,185,129,0.10)' }}>
                          <CheckCircle className="w-4 h-4 text-emerald-300 shrink-0" />
                          <p className="text-emerald-100/90 text-xs">Number saved. Start the gateway and scan the QR code from the dashboard.</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* iMessage */}
                <div
                  className="rounded-2xl overflow-hidden transition-all"
                  style={{ border: `1px solid ${expandedChannel === 'imessage' ? BRAND.redBorder : 'rgba(234,70,71,0.16)'}`, background: expandedChannel === 'imessage' ? 'rgba(234,70,71,0.06)' : 'rgba(255,255,255,0.04)' }}
                >
                  <button className="w-full flex items-center justify-between p-4 text-left" onClick={() => setExpandedChannel(expandedChannel === 'imessage' ? null : 'imessage')}>
                    <div className="flex items-center gap-2">
                      <p className="text-white/88 text-sm font-medium">iMessage</p>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px]" style={{ border: `1px solid ${BRAND.redBorder}`, background: BRAND.redDim, color: '#fca5a5' }}>macOS only</span>
                    </div>
                    <ArrowRight className="w-4 h-4 text-white/35" style={{ transform: expandedChannel === 'imessage' ? 'rotate(90deg)' : 'none' }} />
                  </button>
                  {expandedChannel === 'imessage' && (
                    <div className="px-4 pb-4 space-y-3">
                      <div className="rounded-xl px-3 py-2.5 flex items-start gap-2" style={{ border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)' }}>
                        <Info className="w-3.5 h-3.5 text-white/40 shrink-0 mt-0.5" />
                        <p className="text-white/55 text-[11px] leading-relaxed">
                          <strong className="text-white/75">Requirement:</strong> iMessage must be signed in on this Mac (in the Messages app). You need to be signed in with your Apple ID.
                        </p>
                      </div>
                      {[
                        { n: 1, text: 'Open the Messages app on your Mac → Settings (⌘,) → iMessage tab — confirm you\'re signed in.' },
                        { n: 2, text: 'OpenClaw uses your Apple ID to receive iMessages. Your assistant will only respond to messages from your own Apple ID.' },
                        { n: 3, text: 'Start the gateway first, then go to the dashboard → Channels → iMessage to complete final setup.' },
                      ].map(({ n, text }) => (
                        <div key={n} className="flex items-start gap-3">
                          <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5" style={{ background: BRAND.redDim, border: `1px solid ${BRAND.redBorder}`, color: '#fca5a5' }}>{n}</span>
                          <p className="text-white/65 text-xs leading-relaxed">{text}</p>
                        </div>
                      ))}
                      <button onClick={() => window.electron.openUrl('https://docs.openclaw.ai/channels/imessage')} className="inline-flex items-center gap-1.5 text-xs" style={{ color: 'rgba(252,165,165,0.70)' }}>
                        Full guide <ExternalLink className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Discord, Signal, Slack — compact cards */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { id: 'discord', title: 'Discord', desc: 'Create a bot and add it to your server.', url: 'https://docs.openclaw.ai/channels/discord' },
                    { id: 'signal', title: 'Signal', desc: 'E2E encrypted — needs Signal on your Mac.', url: 'https://docs.openclaw.ai/channels/signal' },
                    { id: 'slack', title: 'Slack', desc: 'Add your assistant to a workspace.', url: 'https://docs.openclaw.ai/channels/slack' },
                  ].map((ch) => (
                    <div key={ch.id} className="rounded-2xl p-4" style={{ border: '1px solid rgba(234,70,71,0.14)', background: 'rgba(255,255,255,0.03)' }}>
                      <p className="text-white/80 text-sm font-medium mb-1">{ch.title}</p>
                      <p className="text-white/45 text-[11px] mb-3 leading-relaxed">{ch.desc}</p>
                      <button onClick={() => window.electron.openUrl(ch.url)} className="inline-flex items-center gap-1.5 text-xs" style={{ color: 'rgba(252,165,165,0.65)' }}>
                        Setup guide <ExternalLink className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex items-start gap-2 rounded-xl px-3 py-2.5" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
                  <Info className="w-3.5 h-3.5 text-white/35 shrink-0 mt-0.5" />
                  <p className="text-white/40 text-xs leading-relaxed">You can connect more channels later from the OpenClaw dashboard → Channels.</p>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 8: Launch Gateway ── */}
          {step === 8 && (
            <div className="max-w-3xl mx-auto min-h-full flex items-center justify-center">
              <div className="w-full space-y-4">
                <div className="flex items-center gap-3 mb-1">
                  <OpenClawIcon size={28} />
                  <div>
                    <h3 className="text-white text-xl font-semibold leading-none">Launch Gateway</h3>
                    <p className="text-white/50 text-xs mt-1">Start the OpenClaw gateway and open your dashboard.</p>
                  </div>
                </div>

                {/* Gateway auth token status */}
                <div
                  className="rounded-2xl p-4 flex items-start gap-3"
                  style={{
                    border: `1px solid ${gatewayConfigStatus === 'done' ? 'rgba(110,231,183,0.35)' : gatewayConfigStatus === 'error' ? BRAND.redBorder : 'rgba(255,255,255,0.10)'}`,
                    background: gatewayConfigStatus === 'done' ? 'rgba(16,185,129,0.08)' : 'rgba(255,255,255,0.04)',
                  }}
                >
                  {gatewayConfigStatus === 'running' && <Loader2 className="w-4 h-4 animate-spin text-white/40 shrink-0 mt-0.5" />}
                  {gatewayConfigStatus === 'done' && <CheckCircle className="w-4 h-4 text-emerald-300 shrink-0 mt-0.5" />}
                  {gatewayConfigStatus === 'error' && <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />}
                  {gatewayConfigStatus === 'idle' && <Loader2 className="w-4 h-4 text-white/30 shrink-0 mt-0.5" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-white/75 text-xs font-medium">
                      {gatewayConfigStatus === 'running' ? 'Setting up secure access…'
                        : gatewayConfigStatus === 'done' ? 'Dashboard access configured'
                        : gatewayConfigStatus === 'error' ? 'Could not set up access token — dashboard may show "unauthorized"'
                        : 'Checking configuration…'}
                    </p>
                    {gatewayConfigStatus === 'done' && gatewayToken && (
                      <p className="text-white/40 text-[11px] mt-0.5 font-mono truncate">Token: {gatewayToken.slice(0, 12)}…</p>
                    )}
                    {gatewayConfigStatus === 'done' && (
                      <p className="text-emerald-100/55 text-[11px] mt-0.5">Your dashboard is secured with a unique access token — it'll be included automatically when you open it.</p>
                    )}
                  </div>
                </div>

                {/* Gateway running status */}
                <div
                  className="rounded-2xl p-5"
                  style={{
                    border: `1px solid ${gatewayStatus === 'running' ? 'rgba(110,231,183,0.40)' : BRAND.redBorder}`,
                    background: gatewayStatus === 'running' ? 'linear-gradient(160deg,rgba(16,82,56,0.28),rgba(23,34,41,0.20))' : 'rgba(234,70,71,0.05)',
                  }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-2.5 h-2.5 rounded-full"
                        style={{
                          background: gatewayStatus === 'running' ? '#34d399' : BRAND.red,
                          boxShadow: gatewayStatus === 'running' ? '0 0 6px rgba(52,211,153,0.8)' : `0 0 6px ${BRAND.redGlow}`,
                        }}
                      />
                      <p className="text-white/88 text-sm font-medium">Gateway</p>
                    </div>
                    {gatewayStatus === 'running'
                      ? <StatusBadge status="done" label="Running" />
                      : gatewayStatus === 'stopped'
                        ? <StatusBadge status="error" label="Not running" />
                        : <StatusBadge status="pending" label="Checking…" />
                    }
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {gatewayStatus !== 'running' && (
                      <button
                        onClick={startGateway}
                        disabled={gatewayStartStatus === 'running'}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium text-white transition-colors disabled:opacity-55"
                        style={{ border: `1px solid ${BRAND.redBorder}`, background: BRAND.redDim }}
                        onMouseEnter={(e) => { if (!e.currentTarget.disabled) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(234,70,71,0.34)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = BRAND.redDim; }}
                      >
                        {gatewayStartStatus === 'running' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                        {gatewayStartStatus === 'running' ? 'Starting…' : 'Start Gateway'}
                      </button>
                    )}
                    <button
                      onClick={checkGatewayStatus}
                      disabled={gatewayCheckLoading}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/18 bg-white/[0.07] text-white/65 text-xs hover:bg-white/[0.12] transition-colors disabled:opacity-40"
                    >
                      {gatewayCheckLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                      Refresh
                    </button>
                    {gatewayStatus === 'running' && (
                      <button
                        onClick={() => window.electron.openUrl(gatewayToken ? `http://127.0.0.1:18789/?token=${encodeURIComponent(gatewayToken)}` : 'http://127.0.0.1:18789/')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white transition-colors"
                        style={{ border: `1px solid ${BRAND.redBorder}`, background: BRAND.redDim }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(234,70,71,0.34)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = BRAND.redDim; }}
                      >
                        Open Dashboard <ExternalLink className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-start gap-2 rounded-xl px-3 py-2.5" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
                  <Info className="w-3.5 h-3.5 text-white/35 shrink-0 mt-0.5" />
                  <p className="text-white/40 text-xs leading-relaxed">
                    If the background helper was installed, the gateway may already be running — hit Refresh to check.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 9: How It Works ── */}
          {step === 9 && (
            <div className="max-w-3xl mx-auto min-h-full flex items-center justify-center">
              <div className="w-full space-y-4">
                <div className="flex items-center gap-3">
                  <OpenClawIcon size={28} />
                  <div>
                    <h3 className="text-white text-xl font-semibold leading-none">How Your Assistant Works</h3>
                    <p className="text-white/50 text-xs mt-1">A quick overview before you start using it.</p>
                  </div>
                </div>

                <div className="space-y-3">
                  {/* What's running */}
                  <div className="rounded-2xl p-4 space-y-3" style={{ border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)' }}>
                    <p className="text-white/85 text-sm font-semibold">What's running in the background?</p>
                    <div className="space-y-2">
                      {[
                        { icon: Zap, title: 'OpenClaw Gateway', desc: 'The brain. Receives your messages, passes them to the AI, and sends back responses. Runs at localhost:18789.' },
                        { icon: Wifi, title: 'LaunchAgent daemon', desc: 'A small background helper that starts the gateway automatically every time you log into your Mac.' },
                        { icon: Bot, title: 'Your AI model', desc: 'Claude or GPT-4 — only called when you send a message. Your API key is used for each conversation.' },
                      ].map(({ icon: Icon, title, desc }) => (
                        <div key={title} className="flex items-start gap-3 rounded-xl px-3 py-2.5" style={{ background: 'rgba(0,0,0,0.25)' }}>
                          <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 mt-0.5" style={{ border: `1px solid ${BRAND.redBorder}`, background: BRAND.redDim }}>
                            <Icon className="w-3.5 h-3.5" style={{ color: '#fca5a5' }} />
                          </div>
                          <div>
                            <p className="text-white/85 text-xs font-medium">{title}</p>
                            <p className="text-white/50 text-[11px] mt-0.5 leading-relaxed">{desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* How to use it */}
                  <div className="rounded-2xl p-4 space-y-3" style={{ border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)' }}>
                    <p className="text-white/85 text-sm font-semibold">How to talk to your assistant</p>
                    <div className="space-y-2 text-white/60 text-xs leading-relaxed">
                      <p className="flex items-start gap-2"><ArrowRight className="w-3 h-3 mt-0.5 shrink-0" style={{ color: BRAND.red }} /> Message it on Telegram, WhatsApp, iMessage, or whatever channel you connected. It replies like a normal chat.</p>
                      <p className="flex items-start gap-2"><ArrowRight className="w-3 h-3 mt-0.5 shrink-0" style={{ color: BRAND.red }} /> You can also chat directly at <button onClick={() => window.electron.openUrl(gatewayToken ? `http://127.0.0.1:18789/?token=${encodeURIComponent(gatewayToken)}` : 'http://127.0.0.1:18789/')} className="underline text-white/80">localhost:18789</button> in your browser — handy for testing.</p>
                      <p className="flex items-start gap-2"><ArrowRight className="w-3 h-3 mt-0.5 shrink-0" style={{ color: BRAND.red }} /> Install skills from the dashboard to give your assistant new abilities — web search, calendar access, code execution, and more.</p>
                    </div>
                  </div>

                  {/* Important warnings */}
                  <div className="rounded-2xl p-4 space-y-2" style={{ border: '1px solid rgba(251,191,36,0.25)', background: 'rgba(251,191,36,0.06)' }}>
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0" />
                      <p className="text-amber-200/85 text-sm font-semibold">Things to know</p>
                    </div>
                    <div className="space-y-2 text-amber-100/65 text-[11px] leading-relaxed">
                      <p className="flex items-start gap-2"><span className="shrink-0 mt-0.5 font-bold text-amber-300">!</span> <span><strong className="text-amber-100/85">Closing SuperCmd is fine</strong> — the OpenClaw gateway keeps running independently in the background. It's not tied to this app.</span></p>
                      <p className="flex items-start gap-2"><span className="shrink-0 mt-0.5 font-bold text-amber-300">!</span> <span><strong className="text-amber-100/85">To fully stop the gateway</strong> run <code className="font-mono bg-black/25 px-1 rounded">openclaw gateway stop</code> in Terminal, or remove the LaunchAgent from the dashboard settings.</span></p>
                      <p className="flex items-start gap-2"><span className="shrink-0 mt-0.5 font-bold text-amber-300">!</span> <span><strong className="text-amber-100/85">Your AI key is used per message</strong> — keep an eye on your API usage. You can set usage limits in the Anthropic/OpenAI console.</span></p>
                      <p className="flex items-start gap-2"><span className="shrink-0 mt-0.5 font-bold text-amber-300">!</span> <span><strong className="text-amber-100/85">All messages are private</strong> — your conversations only go to your chosen AI provider (Anthropic or OpenAI). OpenClaw itself never sees your messages.</span></p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 10: Done ── */}
          {step === 10 && (
            <div className="max-w-3xl mx-auto min-h-full flex items-center justify-center">
              <div className="w-full space-y-5">
                <div className="text-center">
                  <div
                    className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
                    style={{ border: `1px solid ${BRAND.redBorder}`, background: BRAND.redDim }}
                  >
                    <OpenClawIcon size={44} />
                  </div>
                  <h3 className="text-white text-2xl font-bold mb-2">You're all set!</h3>
                  <p className="text-white/55 text-sm leading-relaxed max-w-md mx-auto">
                    OpenClaw is installed and your AI agent gateway is running on your Mac.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <button
                    onClick={() => window.electron.openUrl(gatewayToken ? `http://127.0.0.1:18789/?token=${encodeURIComponent(gatewayToken)}` : 'http://127.0.0.1:18789/')}
                    className="flex items-center gap-3 rounded-2xl p-4 text-left transition-all"
                    style={{ border: `1px solid ${BRAND.redBorder}`, background: BRAND.redDim }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(234,70,71,0.30)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = BRAND.redDim; }}
                  >
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ border: `1px solid ${BRAND.redBorder}`, background: 'rgba(234,70,71,0.20)' }}>
                      <Terminal className="w-4 h-4" style={{ color: '#fca5a5' }} />
                    </div>
                    <div>
                      <p className="text-white text-sm font-semibold">Open Dashboard</p>
                      <p className="text-white/50 text-xs">Chat, sessions, config</p>
                    </div>
                    <ExternalLink className="w-4 h-4 ml-auto shrink-0" style={{ color: 'rgba(252,165,165,0.55)' }} />
                  </button>

                  <button
                    onClick={() => {
                      localStorage.setItem('openclaw_setup_done', 'true');
                      setMode('settings');
                    }}
                    className="flex items-center gap-3 rounded-2xl p-4 text-left transition-all"
                    style={{ border: `1px solid ${BRAND.redBorder}`, background: 'rgba(234,70,71,0.10)' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(234,70,71,0.20)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(234,70,71,0.10)'; }}
                  >
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ border: `1px solid ${BRAND.redBorder}`, background: 'rgba(234,70,71,0.20)' }}>
                      <Settings className="w-4 h-4" style={{ color: '#fca5a5' }} />
                    </div>
                    <div>
                      <p className="text-white text-sm font-semibold">OpenClaw Settings</p>
                      <p className="text-white/50 text-xs">API key, bot, channels</p>
                    </div>
                  </button>

                  <button
                    onClick={() => window.electron.openUrl('https://docs.openclaw.ai/')}
                    className="flex items-center gap-3 rounded-2xl p-4 text-left transition-all"
                    style={{ border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.22)'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.12)'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'; }}
                  >
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border border-white/18 bg-white/10">
                      <ExternalLink className="w-4 h-4 text-white/65" />
                    </div>
                    <div>
                      <p className="text-white/85 text-sm font-semibold">Documentation</p>
                      <p className="text-white/45 text-xs">Channels, skills, advanced config</p>
                    </div>
                  </button>
                </div>

                <div className="rounded-2xl p-4" style={{ border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.03)' }}>
                  <p className="text-white/60 text-xs font-medium mb-2">Next steps</p>
                  <div className="space-y-2 text-xs text-white/48">
                    <p className="flex items-start gap-2"><ArrowRight className="w-3 h-3 shrink-0 mt-0.5 text-white/30" /> Connect a messaging app — Telegram is the quickest to get started with</p>
                    <p className="flex items-start gap-2"><ArrowRight className="w-3 h-3 shrink-0 mt-0.5 text-white/30" /> Your assistant comes with starter abilities — web search, code help, file tasks, and more</p>
                    <p className="flex items-start gap-2"><ArrowRight className="w-3 h-3 shrink-0 mt-0.5 text-white/30" /> Install the iOS or Android app for on-the-go access from your phone</p>
                    <p className="flex items-start gap-2"><ArrowRight className="w-3 h-3 shrink-0 mt-0.5 text-white/30" /> Review memory and conversation settings from the OpenClaw dashboard → Configuration</p>
                  </div>
                </div>

                {/* Test Bot — shown when Telegram is configured */}
                {telegramToken.trim().length > 10 && (
                  <div className="rounded-2xl p-4 space-y-4" style={{ border: `1px solid ${BRAND.redBorder}`, background: BRAND.redDim }}>
                    <div className="flex items-center gap-2">
                      <MessageCircle className="w-4 h-4" style={{ color: '#fca5a5' }} />
                      <p className="text-white/85 text-xs font-semibold">Test Your Bot</p>
                    </div>

                    {/* Step A: Send welcome message (uses allowFrom / auto-detects chat_id) */}
                    <div>
                      <p className="text-white/55 text-xs mb-3">
                        Open Telegram → search{' '}
                        <strong className="text-white/75">@{telegramBotUsername ?? 'your bot'}</strong>{' '}
                        → tap <strong className="text-white/75">Start</strong>. Then click the button below — SuperCmd will detect the pairing and send a greeting.
                      </p>
                      <div className="flex items-center gap-3 flex-wrap">
                        <button
                          onClick={() => { setTestMsgStatus('idle'); setTestMsgError(''); void sendTestMessage(); }}
                          disabled={testMsgStatus === 'checking' || testMsgStatus === 'sending' || testMsgStatus === 'sent'}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{ border: `1px solid ${BRAND.redBorder}`, background: 'rgba(234,70,71,0.30)' }}
                        >
                          {testMsgStatus === 'checking' && <><Loader2 className="w-3 h-3 animate-spin" /> Finding chat…</>}
                          {testMsgStatus === 'sending' && <><Loader2 className="w-3 h-3 animate-spin" /> Sending…</>}
                          {testMsgStatus === 'sent' && <><CheckCircle className="w-3 h-3 text-emerald-400" /> Sent!</>}
                          {(testMsgStatus === 'idle' || testMsgStatus === 'error') && <><MessageCircle className="w-3 h-3" /> Send Welcome Message</>}
                        </button>
                        {testMsgStatus === 'sent' && <span className="text-emerald-400 text-xs">Message delivered!</span>}
                      </div>
                      {testMsgStatus === 'error' && testMsgError && (
                        <p className="mt-2 text-xs" style={{ color: '#fca5a5' }}>{testMsgError}</p>
                      )}
                    </div>

                    {/* Step B: Manual pairing (shown when not yet paired) */}
                    <div className="rounded-xl p-3 space-y-3" style={{ border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(0,0,0,0.25)' }}>
                      <p className="text-white/60 text-xs font-medium">Got a pairing code from the bot? Enter it here:</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <p className="text-white/40 text-[11px]">Pairing code</p>
                          <input
                            type="text"
                            value={manualPairingCode}
                            onChange={(e) => { setManualPairingCode(e.target.value.toUpperCase().trim()); setPairingApproveStatus('idle'); }}
                            placeholder="e.g. LYTKNTGS"
                            className="w-full rounded-lg px-3 py-2 text-sm font-mono outline-none uppercase"
                            style={{ background: '#0a0c10', border: '1px solid rgba(255,255,255,0.14)', color: 'white', letterSpacing: '0.1em' }}
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-white/40 text-[11px]">Your Telegram ID <span className="text-white/25">(from bot reply)</span></p>
                          <input
                            type="text"
                            value={manualTelegramId}
                            onChange={(e) => { setManualTelegramId(e.target.value.trim()); setPairingApproveStatus('idle'); }}
                            placeholder="e.g. 7660299809"
                            className="w-full rounded-lg px-3 py-2 text-sm font-mono outline-none"
                            style={{ background: '#0a0c10', border: '1px solid rgba(255,255,255,0.14)', color: 'white' }}
                          />
                        </div>
                      </div>
                      <button
                        disabled={manualPairingCode.length < 6 || pairingApproveStatus === 'running' || pairingApproveStatus === 'done'}
                        onClick={async () => {
                          setPairingApproveStatus('running');
                          try {
                            const res = await loginShellExec(`openclaw pairing approve telegram ${manualPairingCode} 2>&1`);
                            if (res.exitCode === 0 || res.stdout.toLowerCase().includes('approved')) {
                              // Save numeric ID to allowFrom
                              const numId = manualTelegramId || res.stdout.match(/\d{6,}/)?.[0];
                              if (numId) {
                                const saveScript = `node -e "const fs=require('fs');const p=process.env.HOME+'/.openclaw/openclaw.json';const c=JSON.parse(fs.readFileSync(p,'utf8'));c.channels=c.channels||{};c.channels.telegram=c.channels.telegram||{};const af=c.channels.telegram.allowFrom||[];const id=parseInt(process.env.CHAT_ID);if(!af.includes(id)){af.push(id);c.channels.telegram.allowFrom=af;delete c.channels.telegram.allowList;fs.writeFileSync(p,JSON.stringify(c,null,2));}"`;
                                await window.electron.execCommand('/bin/zsh', ['-l', '-c', saveScript], {
                                  shell: false, env: { HOME, CHAT_ID: numId },
                                }).catch(() => {});
                              }
                              setPairingApproveStatus('done');
                              setManualPairingCode('');
                              // Auto-trigger welcome message
                              await new Promise((r) => setTimeout(r, 800));
                              void sendTestMessage();
                            } else {
                              setPairingApproveStatus('error');
                            }
                          } catch { setPairingApproveStatus('error'); }
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white transition-colors disabled:opacity-40"
                        style={{ border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.08)' }}
                      >
                        {pairingApproveStatus === 'running' && <><Loader2 className="w-3 h-3 animate-spin" /> Approving…</>}
                        {pairingApproveStatus === 'done' && <><CheckCircle className="w-3 h-3 text-emerald-400" /> Paired!</>}
                        {pairingApproveStatus === 'error' && <><XCircle className="w-3 h-3 text-red-400" /> Failed — check the code</>}
                        {(pairingApproveStatus === 'idle') && <>Approve Pairing & Send Welcome</>}
                      </button>
                    </div>
                  </div>
                )}

                <p className="text-white/35 text-xs text-center">
                  Search <strong className="text-white/55">"Set Up OpenClaw"</strong> in SuperCmd to return to this wizard anytime.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Footer navigation ── */}
        <div
          className="px-5 py-3.5 flex items-center justify-between"
          style={{ borderTop: `1px solid rgba(234,70,71,0.12)`, background: 'linear-gradient(180deg, rgba(8,5,5,0.60) 0%, rgba(5,8,17,0.88) 100%)' }}
        >
          <button
            onClick={step === 0 ? onClose : goBack}
            className="px-3 py-1.5 rounded-md text-xs text-white/55 hover:text-white/85 hover:bg-white/[0.08] transition-colors"
          >
            {step === 0 ? 'Close' : 'Back'}
          </button>

          <div className="flex items-center gap-2">
            {step === 7 && (
              <button onClick={skipStep} className="px-3 py-1.5 rounded-md text-xs text-white/42 hover:text-white/65 transition-colors">
                Skip channels
              </button>
            )}
            {step === 6 && (
              <button onClick={skipStep} className="px-3 py-1.5 rounded-md text-xs text-white/42 hover:text-white/65 transition-colors">
                Skip for now
              </button>
            )}

            {step < STEPS.length - 1 ? (
              <button
                onClick={() => void goNext()}
                disabled={!canGoNext()}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ border: `1px solid ${BRAND.redBorder}`, background: BRAND.redDim }}
                onMouseEnter={(e) => { if (!e.currentTarget.disabled) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(234,70,71,0.34)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = BRAND.redDim; }}
              >
                Continue → {STEPS[step + 1]}
              </button>
            ) : (
              <button
                onClick={() => {
                  localStorage.setItem('openclaw_setup_done', 'true');
                  onClose();
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium text-white transition-colors"
                style={{ border: `1px solid ${BRAND.redBorder}`, background: BRAND.redDim }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(234,70,71,0.34)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = BRAND.redDim; }}
              >
                Done <Check className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default OpenClawOnboarding;
