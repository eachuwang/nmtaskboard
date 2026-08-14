import path from "node:path";
import fs from "node:fs";

// 通用 JSON 存储工厂：原子写（tmp + rename），写前把旧文件备份为 .bak
export function jsonStore(dir, filename, defaults = {}) {
  const file = path.join(dir, filename);
  return {
    file,
    read() {
      try {
        return { ...defaults, ...JSON.parse(fs.readFileSync(file, "utf8")) };
      } catch {
        return { ...defaults };
      }
    },
    write(data) {
      fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(file)) fs.copyFileSync(file, file + ".bak");
      const tmp = file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, file);
    }
  };
}
