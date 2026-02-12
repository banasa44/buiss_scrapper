/**
 * Unit tests for company feedback events repository
 *
 * Tests model performance feedback persistence and retrieval
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDbSync, type TestDbHarness } from "../helpers/testDb";
import {
  insertCompanyFeedbackEvent,
  getFeedbackEventsByCompanyId,
} from "@/db/repos/feedbackEventsRepo";
import { upsertCompany } from "@/db/repos/companiesRepo";

describe("feedbackEventsRepo", () => {
  let testDb: TestDbHarness;

  beforeEach(() => {
    testDb = createTestDbSync();
  });

  describe("insertCompanyFeedbackEvent", () => {
    it("should insert a feedback event with all fields", () => {
      // Setup: create a company first
      const companyId = upsertCompany({
        name_raw: "Test Company",
        name_display: "Test Company",
        normalized_name: "test company",
        website_domain: "test.com",
      });

      // Insert feedback event
      const eventId = insertCompanyFeedbackEvent({
        companyId,
        sheetRowIndex: 42,
        feedbackValue: "FP",
        notes: "Model performed well on this company",
      });

      expect(eventId).toBeGreaterThan(0);

      // Verify by retrieving
      const events = getFeedbackEventsByCompanyId(companyId);
      expect(events).toHaveLength(1);
      expect(events[0].companyId).toBe(companyId);
      expect(events[0].sheetRowIndex).toBe(42);
      expect(events[0].feedbackValue).toBe("FP");
      expect(events[0].notes).toBe("Model performed well on this company");
      expect(events[0].createdAt).toBeInstanceOf(Date);
    });

    it("should insert a feedback event with null notes", () => {
      const companyId = upsertCompany({
        name_raw: "Another Company",
        name_display: "Another Company",
        normalized_name: "another company",
        website_domain: "another.com",
      });

      const eventId = insertCompanyFeedbackEvent({
        companyId,
        sheetRowIndex: 50,
        feedbackValue: "FN",
        notes: "",
      });

      expect(eventId).toBeGreaterThan(0);

      const events = getFeedbackEventsByCompanyId(companyId);
      expect(events).toHaveLength(1);
      expect(events[0].feedbackValue).toBe("FN");
      expect(events[0].notes).toBe("");
    });

    it("should support multiple feedback events for the same company", () => {
      const companyId = upsertCompany({
        name_raw: "Multi Feedback Co",
        name_display: "Multi Feedback Co",
        normalized_name: "multi feedback co",
        website_domain: "multifeedback.com",
      });

      // Insert multiple events
      insertCompanyFeedbackEvent({
        companyId,
        sheetRowIndex: 10,
        feedbackValue: "FP",
        notes: "First feedback",
      });

      insertCompanyFeedbackEvent({
        companyId,
        sheetRowIndex: 11,
        feedbackValue: "OK",
        notes: "Second feedback",
      });

      insertCompanyFeedbackEvent({
        companyId,
        sheetRowIndex: 12,
        feedbackValue: "FN",
        notes: "",
      });

      const events = getFeedbackEventsByCompanyId(companyId);
      expect(events).toHaveLength(3);

      // Verify all feedback values are present (order may vary due to same timestamp)
      const feedbackValues = events.map((e) => e.feedbackValue).sort();
      expect(feedbackValues).toEqual(["FN", "FP", "OK"]);

      // Verify notes are present
      const notesPresent = events.filter((e) => e.notes !== "");
      expect(notesPresent).toHaveLength(2);
    });
  });

  describe("getFeedbackEventsByCompanyId", () => {
    it("should return empty array for company with no feedback", () => {
      const companyId = upsertCompany({
        name_raw: "No Feedback Co",
        name_display: "No Feedback Co",
        normalized_name: "no feedback co",
        website_domain: "nofeedback.com",
      });

      const events = getFeedbackEventsByCompanyId(companyId);
      expect(events).toEqual([]);
    });

    it("should only return events for the specified company", () => {
      const company1 = upsertCompany({
        name_raw: "Company 1",
        name_display: "Company 1",
        normalized_name: "company 1",
        website_domain: "company1.com",
      });

      const company2 = upsertCompany({
        name_raw: "Company 2",
        name_display: "Company 2",
        normalized_name: "company 2",
        website_domain: "company2.com",
      });

      insertCompanyFeedbackEvent({
        companyId: company1,
        sheetRowIndex: 20,
        feedbackValue: "FP",
        notes: "Feedback for company 1",
      });

      insertCompanyFeedbackEvent({
        companyId: company2,
        sheetRowIndex: 21,
        feedbackValue: "FN",
        notes: "Feedback for company 2",
      });

      const events1 = getFeedbackEventsByCompanyId(company1);
      expect(events1).toHaveLength(1);
      expect(events1[0].feedbackValue).toBe("FP");

      const events2 = getFeedbackEventsByCompanyId(company2);
      expect(events2).toHaveLength(1);
      expect(events2[0].feedbackValue).toBe("FN");
    });
  });
});
