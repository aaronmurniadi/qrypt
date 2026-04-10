import { describe, it, expect } from "vitest";
import { formatErr, isTextLike, isImage, isVideo, basename, parentVaultPath, listChildRows, ChildRow, ALGORITHM_OPTIONS } from "../lib/vault-utils";
import { backend } from "../../wailsjs/go/models";

describe("vault-utils", () => {
  describe("formatErr", () => {
    it("formats Error objects", () => {
      expect(formatErr(new Error("test error"))).toBe("test error");
    });
    it("formats strings", () => {
      expect(formatErr("string error")).toBe("string error");
    });
  });

  describe("mime type checks", () => {
    it("isTextLike", () => {
      expect(isTextLike("text/plain")).toBe(true);
      expect(isTextLike("application/json")).toBe(true);
      expect(isTextLike("image/png")).toBe(false);
    });

    it("isImage", () => {
      expect(isImage("image/png")).toBe(true);
      expect(isImage("image/jpeg")).toBe(true);
      expect(isImage("text/plain")).toBe(false);
    });

    it("isVideo", () => {
      expect(isVideo("video/mp4")).toBe(true);
      expect(isVideo("image/png")).toBe(false);
    });
  });

  describe("algorithm options", () => {
    it("has all required algorithms", () => {
      const algos = ALGORITHM_OPTIONS.map(a => a.value);
      expect(algos).toContain("aes");
      expect(algos).toContain("serpent");
      expect(algos).toContain("twofish");
    });

    it("has correct display names", () => {
      const aes = ALGORITHM_OPTIONS.find(a => a.value === "aes");
      expect(aes?.label).toContain("AES");

      const serpent = ALGORITHM_OPTIONS.find(a => a.value === "serpent");
      expect(serpent?.label).toContain("Serpent");

      const twofish = ALGORITHM_OPTIONS.find(a => a.value === "twofish");
      expect(twofish?.label).toContain("Twofish");
    });
  });

  describe("path utils", () => {
    it("basename", () => {
      expect(basename("foo/bar.txt")).toBe("bar.txt");
      expect(basename("bar.txt")).toBe("bar.txt");
      expect(basename("foo\\bar.txt")).toBe("bar.txt");
    });

    it("parentVaultPath", () => {
      expect(parentVaultPath("foo/bar/baz.txt")).toBe("foo/bar");
      expect(parentVaultPath("foo")).toBe("");
      expect(parentVaultPath("")).toBe("");
    });
  });

  describe("listChildRows", () => {
    it("lists children correctly", () => {
      const entries = [
        new backend.VaultFileEntry({ path: "a.txt", size: 10, mimeType: "text/plain", modTime: "2023-01-01" }),
        new backend.VaultFileEntry({ path: "dir/b.txt", size: 20, mimeType: "text/plain", modTime: "2023-01-01" }),
        new backend.VaultFileEntry({ path: "dir/c.txt", size: 30, mimeType: "text/plain", modTime: "2023-01-01" }),
        new backend.VaultFileEntry({ path: "dir/subdir/d.txt", size: 40, mimeType: "text/plain", modTime: "2023-01-01" }),
      ];

      const rootRows = listChildRows("", entries);
      expect(rootRows.length).toBe(2);
      expect(rootRows[0].kind).toBe("entry");
      if (rootRows[0].kind === "entry") expect(rootRows[0].entry.path).toBe("a.txt");
      expect(rootRows[1].kind).toBe("folder");
      if (rootRows[1].kind === "folder") expect(rootRows[1].name).toBe("dir");

      const dirRows = listChildRows("dir", entries);
      expect(dirRows.length).toBe(3);
      expect(dirRows[0].kind).toBe("entry");
      if (dirRows[0].kind === "entry") expect(dirRows[0].entry.path).toBe("dir/b.txt");
      expect(dirRows[1].kind).toBe("entry");
      if (dirRows[1].kind === "entry") expect(dirRows[1].entry.path).toBe("dir/c.txt");
      expect(dirRows[2].kind).toBe("folder");
      if (dirRows[2].kind === "folder") expect(dirRows[2].name).toBe("subdir");
    });
  });
});
