import type { WebLinkItem } from "~components/weblink-list/types"
import type { Source } from "~types"
import * as cheerio from "cheerio"
import { removeUnusedHtmlNode } from "./removeUnusedHtmlNode"
import parse from "node-html-parser"

export const buildSource = (): Source => {
  return {
    pageContent: "",
    metadata: {
      title: "",
      source: "",
    },
    score: -1,
  }
}

// TODO: 这里需要新增一个方法用于处理 quickAction
export const mapSourceFromWeblinkList = (
  weblinkList: { content: WebLinkItem; key: string | number }[],
) => {
  return weblinkList?.map((item) => ({
    pageContent: item?.content?.originPageDescription,
    metadata: {
      source: item?.content?.originPageUrl,
      title: item?.content?.originPageTitle,
    },
    score: -1,
  }))
}

export const getContentFromHtmlSelector = (selector: string) => {
  const html = removeUnusedHtmlNode()
  const $ = parse(html)

  console.log(
    "getContentFromHtmlSelector",
    $.querySelector(selector).text,
    `target`,
    document.querySelector(selector),
  )

  return {
    target: document.querySelector(selector),
  }
}
