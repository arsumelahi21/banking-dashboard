import { brand } from "@/lib/brand";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{brand.name}</h1>
      <p className="text-sm opacity-70">{brand.description}</p>
    </main>
  );
}
