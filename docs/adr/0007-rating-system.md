# 0007 — Glicko-2 ratings per mode with seasonal soft reset

- Status: Accepted · Date: 2026-10-01 · Reversibility: Two-way door

## Context
Fair matchmaking across Classic, Blitz, Arena; seasons (V-09); 2v2; new-player protection.

## Decision
Glicko-2 per (mode, format) with rating deviation for uncertainty; visible rank tiers derived from conservative
rating (μ − 2σ); seasonal soft reset (pull toward mean, RD increased); 2v2 uses team average with RD
aggregation; placement matches for new accounts; bots never affect ranked ratings.

## Options rejected
Elo (no uncertainty), TrueSkill 2 (licensing/complexity), pure MMR hidden systems (less explainable to players).
