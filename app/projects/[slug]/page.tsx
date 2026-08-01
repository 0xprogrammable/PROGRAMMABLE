import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  getShowcaseProject,
  showcaseProjects,
} from "@/components/project-showcase-data";
import { ProjectPreviewView } from "@/components/project-preview-view";

export function generateStaticParams() {
  return showcaseProjects.map((project) => ({ slug: project.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const project = getShowcaseProject(slug);
  if (!project) return {};

  return {
    title: `${project.name} · Project preview`,
    description: project.summary,
    robots: { index: false, follow: false },
  };
}

export default async function ProjectPreviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = getShowcaseProject(slug);
  if (!project) notFound();

  return <ProjectPreviewView project={project} />;
}
