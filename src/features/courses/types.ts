export type CourseStatus = "draft" | "published";

export type Course = {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly shortDescription: string;
  readonly status: CourseStatus;
};

export type Module = {
  readonly id: string;
  readonly courseId: string;
  readonly title: string;
  readonly order: number;
};

export type SessionPublicationStatus = "draft" | "published";

export type Session = {
  readonly id: string;
  readonly courseId: string;
  readonly moduleId: string;
  readonly title: string;
  readonly order: number;
  readonly publicationStatus: SessionPublicationStatus;
  readonly releaseAt?: string;
  readonly lessonText?: string;
};
