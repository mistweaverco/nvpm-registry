import { describe, expect, test } from "bun:test";
import type { GitRefEntry } from "../types";
import {
  compareSemver,
  detectTagOverwrites,
  parseLsRemote,
  parseSymrefHead,
  pickLatestSemverTag,
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

describe("parseLsRemote", () => {
  test("parses heads, tags, and peeled tags", () => {
    const out = parseLsRemote(`
ref: refs/heads/main\tHEAD
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\tHEAD
bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\trefs/heads/main
cccccccccccccccccccccccccccccccccccccccc\trefs/heads/develop
dddddddddddddddddddddddddddddddddddddddd\trefs/tags/v1.0.0
eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\trefs/tags/v1.0.0^{}
`);
    expect(out).toEqual([
      { commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", name: "HEAD", peeled: false },
      { commit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", name: "refs/heads/main", peeled: false },
      { commit: "cccccccccccccccccccccccccccccccccccccccc", name: "refs/heads/develop", peeled: false },
      { commit: "dddddddddddddddddddddddddddddddddddddddd", name: "refs/tags/v1.0.0", peeled: false },
      { commit: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", name: "refs/tags/v1.0.0", peeled: true },
    ]);
  });
});

describe("parseSymrefHead", () => {
  test("extracts default branch", () => {
    expect(
      parseSymrefHead("ref: refs/heads/main\tHEAD\naaa\tHEAD\n"),
    ).toBe("main");
    expect(parseSymrefHead("bbb\trefs/heads/main\n")).toBeNull();
  });
});

describe("pickLatestSemverTag", () => {
  test("picks highest semver", () => {
    expect(pickLatestSemverTag(["v1.0.0", "v1.10.2", "v1.9.9"])).toBe("v1.10.2");
    expect(compareSemver("v1.10.0", "v1.9.0")).toBeGreaterThan(0);
  });
});
