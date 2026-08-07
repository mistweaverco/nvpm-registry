import { describe, expect, test } from "bun:test";
import type { GitRefEntry } from "../types";
import {
  detectTagOverwrites,
  tagMapFromRefs,
} from "./git-metadata";

describe("detectTagOverwrites", () => {
  const refs: GitRefEntry[] = [
    {
      ref: "v1.0.0",
      kind: "tag",
      commit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      commit_date_unix: 1,
    },
    {
      ref: "main",
      kind: "branch",
      commit: "cccccccccccccccccccccccccccccccccccccccc",
      commit_date_unix: 2,
    },
  ];

  test("detects moved tag", () => {
    const overwrites = detectTagOverwrites(refs, {
      "v1.0.0": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(overwrites).toEqual([
      {
        tag: "v1.0.0",
        previous_commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        current_commit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    ]);
  });

  test("ignores unchanged tag", () => {
    const overwrites = detectTagOverwrites(refs, {
      "v1.0.0": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
    expect(overwrites).toEqual([]);
  });

  test("ignores new tags", () => {
    const overwrites = detectTagOverwrites(refs, {});
    expect(overwrites).toEqual([]);
  });
});

describe("tagMapFromRefs", () => {
  test("maps only tag refs", () => {
    const m = tagMapFromRefs([
      { ref: "main", kind: "branch", commit: "abc", commit_date_unix: 0 },
      { ref: "v1.0.0", kind: "tag", commit: "def", commit_date_unix: 0 },
    ]);
    expect(m).toEqual({ "v1.0.0": "def" });
  });
});
