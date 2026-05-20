import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'usdc-mm — MetaMask smart account on Stellar',
  description:
    'Three verbs (Create, Receive, Send) — give a MetaMask user USDC on Stellar by creating them a smart account whose admin is their Ethereum key.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
