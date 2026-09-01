declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
    WHATSAPP_VERIFY_TOKEN?: string;
    WHATSAPP_APP_SECRET?: string;
    WHATSAPP_ACCESS_TOKEN?: string;
    WHATSAPP_PHONE_NUMBER_ID?: string;
    WHATSAPP_ALLOWED_NUMBERS?: string;
    WHATSAPP_GRAPH_API_VERSION?: string;
  }
}
