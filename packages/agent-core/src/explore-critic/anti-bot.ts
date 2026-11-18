export interface BotChallengeDetection {
  isBlocked: boolean;
  provider?: "cloudflare" | "amazon" | "perimeterx" | "datadome" | "generic";
  reason?: string;
}

const AMAZON_BOT_SIGNATURES = [
  /to discuss automated access to amazon data/i,
  /api-services-support@amazon\.com/i,
  /robot check/i,
  /enter the characters you see below/i,
  /type the characters you see in this image/i,
];

const CLOUDFLARE_BOT_SIGNATURES = [
  /attention required!\s*\|\s*cloudflare/i,
  /cf-browser-verification/i,
  /ray id:/i,
  /just a moment\.\.\./i,
  /enable javascript and cookies to continue/i,
  /checking your browser before accessing/i,
];

const GENERIC_BOT_SIGNATURES = [
  /access denied/i,
  /403 forbidden/i,
  /please verify you are a human/i,
  /verify you are a human/i,
  /security check to access/i,
  /pardon our interruption/i,
  /shieldsquare captcha/i,
  /press & hold/i,
  /perimeterx/i,
  /datadome/i,
];

export function detectBotChallenge(params: {
  url?: string;
  title?: string;
  content?: string;
  error?: string;
}): BotChallengeDetection {
  const { title = "", content = "", error = "" } = params;
  const combined = `${title} ${content} ${error}`.toLowerCase();

  for (const sig of AMAZON_BOT_SIGNATURES) {
    if (sig.test(combined)) {
      return {
        isBlocked: true,
        provider: "amazon",
        reason: "Target returned Amazon anti-bot captcha/challenge.",
      };
    }
  }

  for (const sig of CLOUDFLARE_BOT_SIGNATURES) {
    if (sig.test(combined)) {
      return {
        isBlocked: true,
        provider: "cloudflare",
        reason: "Target returned Cloudflare browser verification challenge.",
      };
    }
  }

  for (const sig of GENERIC_BOT_SIGNATURES) {
    if (sig.test(combined)) {
      return {
        isBlocked: true,
        provider: "generic",
        reason: "Target returned bot protection challenge or 403 access denial.",
      };
    }
  }

  const isShortOrEmpty = content.trim().length < 150;
  if (isShortOrEmpty && (title.includes("Robot") || title.includes("Blocked") || title.includes("Denied"))) {
    return {
      isBlocked: true,
      provider: "generic",
      reason: "Page payload stripped or redirected to bot verification gate.",
    };
  }

  return { isBlocked: false };
}
