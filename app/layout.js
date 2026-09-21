import { Archivo, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

const archivo = Archivo({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-archivo',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata = {
  title: "Rubik's Cube Console",
  description:
    "An interactive 3D Rubik's Cube that solves itself: the beginner's method in code, one typed model decision per step.",
  applicationName: "Rubik's Cube Console",
  openGraph: {
    title: "Rubik's Cube Console",
    description: "A cube that solves itself \u2014 one typed model decision per step, code plays the moves.",
    type: 'website',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eceae5' },
    { media: '(prefers-color-scheme: dark)', color: '#101218' },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${archivo.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
