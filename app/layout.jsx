import "./globals.css";

export const metadata = {
  title: "Cloth Try-On Studio",
  description: "Private AI wardrobe and try-on prototype"
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
