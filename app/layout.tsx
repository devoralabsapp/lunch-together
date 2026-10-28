import type { Metadata } from "next";
import {cookies} from 'next/headers';
import {I18nProvider} from '../components/i18n-provider';
import {LOCALE_COOKIE,parseLocale,translate} from '../lib/i18n';
import {ThemeProvider} from '../components/theme-provider';
import {THEME_COOKIE,parseTheme} from '../lib/theme';
import "./rice.css";
import "./interface.css";
import "./statistics.css";
import "./pickup.css";
import "./users.css";
import "./payment.css";
import "./features.css";
import "./merchant-status.css";
import "./activity.css";
import "./personal.css";
import "./themes.css";
import "./retro-theme.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = parseLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return {
    title: translate(locale, "Cơm Nhà · Đặt cơm văn phòng"),
    description: translate(locale, "Chọn món ngon, đặt cơm cùng đồng nghiệp và theo dõi thanh toán mỗi ngày."),
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const preferences=await cookies(),locale=parseLocale(preferences.get(LOCALE_COOKIE)?.value),theme=parseTheme(preferences.get(THEME_COOKIE)?.value);
  return (
    <html lang={locale} data-theme={theme}>
      <body className="antialiased">
        <I18nProvider initialLocale={locale}><ThemeProvider initialTheme={theme}>{children}</ThemeProvider></I18nProvider>
      </body>
    </html>
  );
}
