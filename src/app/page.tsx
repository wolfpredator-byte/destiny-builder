"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Character = {
  characterId: string;
  className: string;
  light: number;
  emblemPath: string;
  emblemBackgroundPath: string;
  dateLastPlayed: string;
};

export default function Home() {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadCharacters() {
      try {
        const response = await fetch("/api/destiny/characters");
        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.error || "Failed to load characters");
        }

        setCharacters(data.characters);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Unknown error"
        );
      } finally {
        setLoading(false);
      }
    }

    loadCharacters();
  }, []);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p>Loading Guardians...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Destiny Builder</h1>

          <p className="mt-4 text-red-500">
            {error}
          </p>

          <a
            href="/api/auth/bungie"
            className="mt-6 inline-block rounded-lg bg-white px-6 py-3 font-semibold text-black"
          >
            Login with Bungie
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <h1 className="text-4xl font-bold">
            Your Guardians
          </h1>

          <Link
            href="/vault"
            className="rounded-lg border border-white/20 px-5 py-3 font-semibold transition hover:bg-white hover:text-black"
          >
            Open Vault
          </Link>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {characters.map((character) => (
            <Link
              key={character.characterId}
              href={`/guardian/${character.characterId}`}
              className="block overflow-hidden rounded-xl border border-white/10 bg-black transition hover:scale-[1.02] hover:border-white/30"
            >
              <div
                className="h-40 bg-cover bg-center"
                style={{
                  backgroundImage: `url(https://www.bungie.net${character.emblemBackgroundPath})`,
                }}
              />

              <div className="p-5">
                <div className="flex items-center gap-4">
                  <img
                    src={`https://www.bungie.net${character.emblemPath}`}
                    alt={`${character.className} emblem`}
                    className="h-16 w-16 rounded"
                  />

                  <div>
                    <h2 className="text-2xl font-semibold">
                      {character.className}
                    </h2>

                    <p className="text-lg">
                      Power {character.light}
                    </p>
                  </div>
                </div>

                <p className="mt-4 text-sm text-white/60">
                  Last played:{" "}
                  {new Date(
                    character.dateLastPlayed
                  ).toLocaleString()}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}