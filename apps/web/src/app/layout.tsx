import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'UTL-NEXUS | Yield Intelligence',
  icons: { icon: '/utac-icon.png', apple: '/utac-icon.png' },
  description: 'Semiconductor yield intelligence and manufacturing analytics',
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="utac" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{document.documentElement.dataset.theme=localStorage.getItem('nexus-theme')==='dark'?'dark':'utac'}catch{}",
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
