# Supabase Auth Boilerplate

![Next.js](https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=for-the-badge&logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Auth-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)
![React Query](https://img.shields.io/badge/React_Query-v5-FF4154?style=for-the-badge&logo=react-query&logoColor=white)

A modern, production-ready boilerplate built with **Next.js 16 (App Router)** and **Supabase**, designed to jumpstart your web application development with best practices in mind.

## 🚀 Features

- **Next.js 16 (App Router)**: Utilizing the latest React Server Components and routing capabilities with the new `proxy.ts` convention.
- **Supabase Authentication**: Secure and scalable user authentication and database.
- **Upstash Rate Limiting**: Multi-layer protection (IP, Email, and Global) using Upstash Redis for signup, login, and resend verification.
- **Email Verification Flow**: Dedicated verify-email page with magic-link handling, resend verification, and rate-limited resend (IP, email, global).
- **Cloudflare Turnstile**: Bot protection using the latest non-interactive captcha.
- **ZeptoMail**: Reliable transactional email delivery service.
- **Forgot Password Flow**: Secure password recovery with rate limiting (IP, Email, Global) and Cloudflare Turnstile protection.
- **Global Auth Sync**: Real-time session synchronization across multiple browser tabs.
- **TypeScript**: Fully typed codebase for better developer experience and code quality.
- **Tailwind CSS 4**: The latest utility-first CSS framework for rapid and responsive UI development.
- **TanStack Query v5**: Powerful asynchronous state management for data fetching.
- **React Hook Form + Zod**: Type-safe and performant form handling with schema validation.
- **Internationalization (i18n)**: Built-in support for multiple languages using `next-intl`.
- **Lucide React**: Beautiful and consistent icon set.
- **Linting & Formatting**: Pre-configured ESLint for consistent code style.

## 🛠️ Tech Stack

- **Framework**: [Next.js](https://nextjs.org/)
- **Database & Auth**: [Supabase](https://supabase.com/)
- **Rate Limiting**: [Upstash Redis](https://upstash.com/)
- **Bot Protection**: [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/)
- **Email**: [ZeptoMail](https://www.zoho.com/zeptomail/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **State Management**: [TanStack Query](https://tanstack.com/query/latest)
- **Forms**: [React Hook Form](https://react-hook-form.com/) & [Zod](https://zod.dev/)
- **Icons**: [Lucide React](https://lucide.dev/)

## ⚡ Getting Started

Follow these steps to set up the project locally.

### Prerequisites

- **Node.js** (v18 or higher recommended)
- **npm**, **yarn**, **pnpm**, or **bun**
- A **Supabase** project (Create one at [supabase.com](https://supabase.com/))

### Installation

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/your-username/supabase-auth-boilerplate.git
    cd supabase-auth-boilerplate
    ```

2.  **Install dependencies:**

    ```bash
    npm install
    # or
    yarn install
    # or
    pnpm install
    # or
    bun install
    ```

3.  **Environment Setup:**

    Create a `.env.local` file in the root directory and add your Supabase credentials:

    ```bash
    # Supabase
    NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
    NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
    SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

    # Upstash Redis (for rate limiting)
    UPSTASH_REDIS_REST_URL=your_upstash_url
    UPSTASH_REDIS_REST_TOKEN=your_upstash_token

    # Cloudflare Turnstile
    NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY=your_site_key
    CLOUDFLARE_TURNSTILE_SECRET_KEY=your_secret_key

    # ZeptoMail (for emails)
    ZEPTOMAIL_URL=api.zeptomail.in/
    ZEPTOMAIL_TOKEN=your_zeptomail_token
    EMAIL_RECIPIENT=your_recipient_email
    EMAIL_SENDER_ADDRESS=your_sender_address
    EMAIL_SENDER_NAME=your_sender_name
    ```

    > **Note:** You can find these keys in your Supabase project settings under **Project Settings > API**.

4.  **Run the Development Server:**

    ```bash
    npm run dev
    # or
    yarn dev
    # or
    pnpm dev
    # or
    bun dev
    ```

    Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## 📂 Project Structure

```bash
src/
├── app/              # Next.js App Router pages and layouts
│   └── [locale]/auth/  # Auth pages (login, signup, verify-email, confirm)
├── components/       # Reusable UI components
├── constants/        # Global constants
├── hooks/            # Custom React hooks
├── lib/              # Utility libraries and configurations
├── loc/              # Localization/i18n files
├── services/         # API services and data fetching logic
├── styles/           # Global styles
├── utils/            # Helper functions (e.g., Supabase client)
└── proxy.ts          # Next.js Proxy/Middleware (Auth protection & i18n)
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
**Note:** All Pull Requests will be reviewed and merged by the project maintainers. Public contributors are encouraged to raise PRs, but merging is restricted to repository administrators.

1.  Fork the project
2.  Create your feature branch (`git checkout -b feature/AmazingFeature`)
3.  Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4.  Push to the branch (`git push origin feature/AmazingFeature`)
5.  Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
