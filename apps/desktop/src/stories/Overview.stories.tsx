import { composeStories, type Meta } from "@storybook/react-vite";
import * as items from "./Items.stories";
import { StoryTurn } from "./StoryTurn";
import * as tools from "./Tools.stories";
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
  <main className="renderer-overview">
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
  </main>
);
