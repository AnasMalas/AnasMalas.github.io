const path = require("node:path");
const Image = require("@11ty/eleventy-img");

module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  eleventyConfig.addPassthroughCopy({ "src/favicon.svg": "favicon.svg" });
  eleventyConfig.addPassthroughCopy({ "src/CNAME": "CNAME" });

  eleventyConfig.addFilter("readableDate", (value) => {
    if (!value) return "";
    return new Intl.DateTimeFormat("en", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC"
    }).format(new Date(value));
  });

  eleventyConfig.addFilter("shortDate", (value) => {
    if (!value) return "";
    const date = new Date(value);
    return `${date.getUTCFullYear()}.${String(date.getUTCMonth() + 1).padStart(2, "0")}.${String(date.getUTCDate()).padStart(2, "0")}`;
  });

  eleventyConfig.addFilter("isoDate", (value) => {
    if (!value) return "";
    return new Date(value).toISOString();
  });

  eleventyConfig.addFilter("xmlEscape", (value) => String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;"));

  eleventyConfig.addFilter("excerpt", (value, length = 150) => {
    const text = String(value || "")
      .replace(/<[^>]*>/g, "")
      .replace(/[#*_`>]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return text.length > length ? `${text.slice(0, length).trimEnd()}…` : text;
  });

  eleventyConfig.addNunjucksAsyncShortcode("responsiveImage", async function (src, alt, sizes = "100vw") {
    const metadata = await Image(path.resolve(src), {
      widths: [480, 800, 1200],
      formats: ["avif", "webp", "jpeg"],
      outputDir: "./_site/assets/generated/",
      urlPath: "/assets/generated/",
      filenameFormat: function (id, srcPath, width, format) {
        const sourceName = path.basename(srcPath, path.extname(srcPath));
        return `${sourceName}-${width}w.${format}`;
      }
    });
    return Image.generateHTML(metadata, {
      alt,
      sizes,
      loading: "lazy",
      decoding: "async"
    });
  });

  eleventyConfig.addCollection("notes", (collectionApi) => collectionApi
    .getFilteredByGlob("src/notes/*.md")
    .filter((item) => !item.data.draft)
    .sort((a, b) => b.date - a.date));

  return {
    dir: {
      input: "src",
      includes: "_includes",
      data: "_data",
      output: "_site"
    },
    templateFormats: ["md", "njk", "html", "xml", "txt"],
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
    passthroughFileCopy: true,
    pathPrefix: "/"
  };
};
