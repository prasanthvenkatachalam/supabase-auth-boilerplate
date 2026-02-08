/**
 * Cloudflare Turnstile Validation Utility
 */

interface TurnstileVerifyResponse {
  success: boolean;
  "error-codes": string[];
  challenge_ts?: string;
  hostname?: string;
}

export async function validateTurnstileToken(token: string, ip?: string): Promise<{ success: boolean; error?: string }> {
  const secretKey = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;

  if (!secretKey) {
    console.warn("CLOUDFLARE_TURNSTILE_SECRET_KEY is not set. Skipping Turnstile validation.");
    return { success: true };
  }

  try {
    const formData = new FormData();
    formData.append("secret", secretKey);
    formData.append("response", token);
    if (ip) {
      formData.append("remoteip", ip);
    }

    const result = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: formData,
    });

    const data: TurnstileVerifyResponse = await result.json();

    if (!data.success) {
      console.error("Turnstile validation failed:", data["error-codes"]);
      return { 
        success: false, 
        error: "Captcha validation failed. Please try again." 
      };
    }

    return { success: true };
  } catch (error) {
    console.error("Error validating Turnstile token:", error);
    // Fail open or closed depending on security requirements. 
    // Failing closed (returning false) is safer for security but risks blocking users if Cloudflare is down.
    // Given this is a critical auth flow, we might want to log and allow, or block. 
    // Let's block for now as it's a security feature.
    return { 
      success: false, 
      error: "Unable to validate captcha. Please try again later." 
    };
  }
}
