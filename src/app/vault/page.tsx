"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type DestinyItem = {
  itemHash: number;
  itemInstanceId: string | null;
  bucketHash: number | null;
  quantity: number;

  name: string;
  description: string;
  icon: string | null;

  itemTypeDisplayName: string | null;
  itemType: number | null;
  itemSubType: number | null;

  tierTypeName: string | null;
  equippable: boolean;

  category: string;
};

export default function VaultPage() {
  const [items, setItems] = useState<DestinyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadVault() {
      try {
        const response = await fetch("/api/destiny/vault");
        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(
            data.error || "Failed to load Vault"
          );
        }

        setItems(data.items ?? []);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Unknown error"
        );
      } finally {
        setLoading(false);
      }
    }

    loadVault();
  }, []);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p>Loading Vault...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-500">{error}</p>

          <Link
            href="/"
            className="mt-6 inline-block rounded-lg bg-white px-6 py-3 font-semibold text-black"
          >
            Back to Guardians
          </Link>
        </div>
      </main>
    );
  }

  const weapons = items.filter(
    (item) => item.category === "weapon"
  );

  const armor = items.filter(
    (item) => item.category === "armor"
  );

  const other = items.filter(
    (item) =>
      item.category !== "weapon" &&
      item.category !== "armor"
  );

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-7xl">
        <Link
          href="/"
          className="mb-6 inline-block text-sm text-white/60 hover:text-white"
        >
          ← Back to Guardians
        </Link>

        <div className="mb-10">
          <h1 className="text-4xl font-bold">
            Vault
          </h1>

          <p className="mt-2 text-white/60">
            {items.length} items stored
          </p>
        </div>

        <ItemSection
          title="Weapons"
          items={weapons}
        />

        <ItemSection
          title="Armor"
          items={armor}
        />

        <ItemSection
          title="Other"
          items={other}
        />
      </div>
    </main>
  );
}

function ItemSection({
  title,
  items,
}: {
  title: string;
  items: DestinyItem[];
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="mb-12">
      <div className="mb-5 flex items-center gap-3">
        <h2 className="text-3xl font-bold">
          {title}
        </h2>

        <span className="rounded-full bg-white/10 px-3 py-1 text-sm text-white/60">
          {items.length}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {items.map((item, index) => (
          <ItemCard
            key={
              item.itemInstanceId ??
              `${item.itemHash}-${index}`
            }
            item={item}
          />
        ))}
      </div>
    </section>
  );
}

function ItemCard({ item }: { item: DestinyItem }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex gap-4">
        {item.icon ? (
          <img
            src={`https://www.bungie.net${item.icon}`}
            alt={item.name}
            className="h-16 w-16 rounded"
          />
        ) : (
          <div className="h-16 w-16 rounded bg-white/10" />
        )}

        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold">
            {item.name}
          </h3>

          <p className="text-sm text-white/60">
            {item.itemTypeDisplayName ??
              "Unknown type"}
          </p>

          {item.tierTypeName && (
            <p className="mt-1 text-sm">
              {item.tierTypeName}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}