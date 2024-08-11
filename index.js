const config = require("config");
const { DateTime } = require("luxon");
const axios = require("axios");
const util = require("util");
const { parse } = require("node-html-parser");
const { writeFile, readFile } = require("fs").promises;
const path = require("path");

const baseUrl = config.get("gift.baseUrl");

const getData = async () => {
  const dataFile = config.get("data.location");
  const filepath = path.join(__dirname, dataFile);
  try {
    const data = await readFile(filepath);
    return JSON.parse(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    } else {
      throw error;
    }
  }
};

const saveData = async (data) => {
  const dataFile = config.get("data.location");
  const filepath = path.join(__dirname, dataFile);
  await writeFile(filepath, JSON.stringify(data, null, 2));
};

const sendWebhook = async (url, items) => {
  const webhookUrl = config.get("discord.webhook");
  
  const embeds = [{
      title: config.get('discord.embed.title'),
      author: {
        name: config.get("discord.embed.author.name"),
      },
      // color: config.get("discord.embed.color"),
      color: Math.random() * 0xFFFFFF | 0,
      url,
      timestamp: DateTime.now().toISO(),
      description: items.map((item) => {
        return convertLinksToMarkdown(item).trim()
      }).join("\n-----------\n"),
  }]

  console.log(" Sending webhook with", embeds.length, "items");

  await axios.post(webhookUrl + '?wait=true', { embeds });
};

const convertLinksToMarkdown = (item) => {
  // Find all <a> tags
  const anchorTags = item.querySelectorAll("a");

  // Iterate through each <a> tag
  anchorTags.forEach((anchor) => {
	const href = baseUrl + anchor.getAttribute("href");
	const text = anchor.innerText;

	// Create the Markdown link
	const markdownLink = `[${text}](${href})`;

	// Replace the <a> tag with the Markdown link
	anchor.replaceWith(markdownLink);
  });

  // Return the modified HTML content
  return item.textContent;
};

(async () => {
  try {
    console.log("Running at", DateTime.now().toISO());

    if(!process.env.DISCORD_WEBHOOK_URL) {
      console.error("DISCORD_WEBHOOK_URL not set, exiting");
      return;
    }

    const data = await getData();

    const newsUrlFormat = config.get("gift.newsUrlFormat");
    
    const dateFormat = config.get("gift.dateFormat");
    // const date = DateTime.now().toFormat(dateFormat);
    const date = DateTime.now().minus({ days: 13 }).toFormat(dateFormat);
    const url = util.format(newsUrlFormat, baseUrl, date);
    console.log("Fetching data from", url);

    const response = await axios.get(url);

    const root = parse(response.data);
    const newsItems = root.querySelectorAll(config.get("gift.newsSelector"));

    // new month with new data, save everything and update
    if (data?.date !== date) {
      console.log("New month, saving data");
      await sendWebhook(url, newsItems);
      await saveData({ date, newsItemCount: newsItems.length });
      return;
    }

    // if diff count, also update
    if (data?.newsItemCount !== newsItems.length) {
      console.log("New news items, sending webhook");
      const newItemsCount = newsItems.length - data.newsItemCount;
      const newItems = newsItems.slice(0, newItemsCount);

      await sendWebhook(url, newItems);
      await saveData({ date, newsItemCount: newsItems.length });
      return;
    }

    console.log("No new news items");
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.status === 404) {
        console.error("Month has no data, exiting");
        return;
      }

      console.error(
        "Error fetching data: ",
        error.response.status,
        error.response.statusText
      );
      console.error(error.response.data);
    } else {
      console.error(error);
    }
  }
})();
