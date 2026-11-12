import { composeStories, type Meta } from "@storybook/react-vite";
import * as items from "./item-fixtures";
import { StoryTurn } from "./StoryTurn";
import * as tools from "./tool-fixtures";
import "./overview.css";

export default {
  title: "Chat/Overview",
  parameters: { gallery: true },
} satisfies Meta;

const groups = [
  { title: "Items", stories: composeStories(items) },
  { title: "Tools", stories: composeStories(tools) },
];

export const AllComponents = () => (
  <div className="renderer-overview">
    <h1>Chat renderers</h1>
    {groups.map(({ title, stories }) => (
      <section key={title}>
        <h2>{title}</h2>
        {Object.entries(stories).map(([key, Story]) => (
          <section className="renderer-specimen" key={key}>
            <h3>{Story.storyName}</h3>
            <StoryTurn role={Story.parameters.role}>
              <Story />
            </StoryTurn>
          </section>
        ))}
      </section>
    ))}
  </div>
);
