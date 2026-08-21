import Image from "next/image";
import type { ReactNode } from "react";

import type {
  CreatorArticleInlineV1,
  CreatorArticleMarkV1,
  CreatorArticleV1,
} from "@/lib/creator-article/contract-v1";
import {
  CreatorArticleLinkIcon,
  creatorArticleLinkProviderV1,
} from "@/components/creator-article-link-icon";

import styles from "./creator-article.module.css";

export { creatorArticleLinkProviderV1 };

export function CreatorArticle({ article }: { article: CreatorArticleV1 | null }) {
  if (article === null) return null;
  return (
    <article className={styles.article} aria-labelledby="creator-article-title">
      {article.bannerImage ? (
        <figure className={`${styles.media} ${styles.banner}`}>
          <Image
            src={article.bannerImage.url}
            alt={article.bannerImage.alt}
            width={article.bannerImage.width}
            height={article.bannerImage.height}
            sizes="(max-width: 720px) 100vw, (max-width: 1200px) 92vw, 1120px"
            unoptimized
          />
          {article.bannerImage.caption ? (
            <figcaption>{article.bannerImage.caption}</figcaption>
          ) : null}
        </figure>
      ) : null}
      <header className={styles.header}>
        <p className={styles.eyebrow}>From the creator</p>
        <h2 id="creator-article-title">{article.title}</h2>
      </header>
      <div className={styles.body}>
        {article.document.content.map((block, index) => {
          if (block.type === "paragraph") {
            return <p key={index}>{renderInline(block.content ?? [])}</p>;
          }
          if (block.type === "heading") {
            return block.attrs.level === 2
              ? <h3 key={index}>{renderInline(block.content)}</h3>
              : <h4 key={index}>{renderInline(block.content)}</h4>;
          }
          if (block.type === "articleImage") {
            return (
              <figure
                className={`${styles.media} ${styles[block.attrs.size]}`}
                key={`${block.attrs.url}:${index}`}
              >
                <Image
                  src={block.attrs.url}
                  alt={block.attrs.alt}
                  width={block.attrs.width}
                  height={block.attrs.height}
                  sizes={block.attrs.size === "wide"
                    ? "(max-width: 720px) 100vw, (max-width: 1200px) 92vw, 1120px"
                    : block.attrs.size === "compact"
                      ? "(max-width: 720px) 74vw, 520px"
                      : "(max-width: 720px) 92vw, 720px"}
                  unoptimized
                />
                {block.attrs.caption ? <figcaption>{block.attrs.caption}</figcaption> : null}
              </figure>
            );
          }
          const List = block.type === "orderedList" ? "ol" : "ul";
          return (
            <List key={index}>
              {block.content.map((item, itemIndex) => (
                <li key={itemIndex}>
                  {item.content.map((paragraph, paragraphIndex) => (
                    <p key={paragraphIndex}>{renderInline(paragraph.content ?? [])}</p>
                  ))}
                </li>
              ))}
            </List>
          );
        })}
      </div>
      <footer className={styles.updated}>
        Updated {new Intl.DateTimeFormat("en", {
          year: "numeric", month: "short", day: "numeric",
        }).format(new Date(article.updatedAt))}
      </footer>
    </article>
  );
}

function renderInline(nodes: readonly CreatorArticleInlineV1[]) {
  return nodes.map((node, index) => {
    if (node.type === "hardBreak") return <br key={index} />;
    let content: ReactNode = node.text;
    for (const mark of node.marks ?? []) content = applyMark(mark, content, index);
    return <span key={index}>{content}</span>;
  });
}

function applyMark(mark: CreatorArticleMarkV1, content: ReactNode, key: number) {
  if (mark.type === "bold") return <strong key={`bold-${key}`}>{content}</strong>;
  if (mark.type === "italic") return <em key={`italic-${key}`}>{content}</em>;
  return (
    <a
      className={styles.link}
      data-creator-link-provider={creatorArticleLinkProviderV1(mark.attrs.href)}
      href={mark.attrs.href}
      target="_blank"
      rel="noopener noreferrer"
      key={`link-${key}`}
    >
      <CreatorArticleLinkIcon href={mark.attrs.href} className={styles.linkIcon} />
      {content}
    </a>
  );
}
